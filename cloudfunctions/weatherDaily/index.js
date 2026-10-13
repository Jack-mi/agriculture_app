// 每日 06:30 定时触发：扫描所有在种的季，为对应地块拉取昨日天气写入 weather 集合。
// 服务端 admin 权限扫描全量用户；src=manual 的手工修正记录永不覆盖。
// 写入的 weather 文档带该地块属主的 _openid，否则客户端按「仅创建者可读写」拉不到。
//
// 同一次定时跑批顺带发三类订阅消息（都是「一次性订阅」，点一次允许 = 1 次额度，
// 额度记在 users.subs.{weather,task,alert}，发送成功才扣，扣完客户端会再请用户订阅）：
//   weather 天气提醒：每天在种地块的当日天气
//   alert  灾害预警：未来 10 天预报触发规则（连阴雨/暴雨/霜冻/大风/干热风），同一预警不重复发
//   task   日程提醒：明天（含已过期）到期的待办任务，每人每天最多 1 条
const cloud = require('wx-server-sdk');
const meteo = require('./meteo.js');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 模板字段 key 已与 mp 后台「订阅消息 → 我的模板 → 详情」逐字核对（2026-10-13）：
// 天气 日期date1/城市phrase2/天气phrase3/温度character_string4/降雨量thing6
// 任务 农事作业thing28/农事时间time29/提醒时间time30/任务名称thing31
// 预警 预警内容thing1/预警类型phrase3/预警等级phrase4/发布时间date5/地块名称thing15
const TEMPLATES = {
  weather: 'uBHxIQ4wSvJUk3OlAjrc-6i9S2nCzsyVmz5AobkEY4o', // 日期/城市/天气/温度/降雨量
  task: 'QMWy3vM6cTQ9047ntC71B3yon6V2QuI4YVLonHwx1eU',    // 农事作业/农事时间/提醒时间/任务名称
  alert: '2Km2bGsLWsuTEYSU9cZ28SeZUEPJ_W-ey5dULONH6z0'    // 预警类型/预警等级/预警内容/发布时间/地块名称
};
// 未正式发布前跳体验版；上线后改 'formal'
const MINIPROGRAM_STATE = 'trial';
const PUSH_PAGE = 'pages/index/index';

// 本环境是 CloudBase 独立环境：cloud.openapi 拿不到微信 openapi access_token
// （-501001 invalid wx openapi access_token，wx-server-sdk 2.6.3 / 4.0.2 均实测）。
// 改为直连微信服务端 API：stable_token 换 access_token → cgi-bin/message/subscribe/send。
// AppID/AppSecret 存 config 集合 wx_msgs 文档（与 advisor_ai 的 apiKey 同一管理模式，不进代码库）。
function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

let _wxToken = { token: '', exp: 0 };
async function wxAccessToken(cfg) {
  if (_wxToken.token && Date.now() < _wxToken.exp) return _wxToken.token;
  const r = await postJSON('https://api.weixin.qq.com/cgi-bin/stable_token',
    { grant_type: 'client_credential', appid: cfg.appid, secret: cfg.secret });
  if (!r.access_token) throw new Error('stable_token: ' + JSON.stringify(r).slice(0, 150));
  _wxToken = { token: r.access_token, exp: Date.now() + ((r.expires_in || 7200) - 300) * 1000 };
  return _wxToken.token;
}

function cut(s, n) { s = String(s === null || s === undefined ? '' : s); return s.length > n ? s.slice(0, n) : s; }
function md(d) { return (+d.slice(5, 7)) + '月' + (+d.slice(8)) + '日'; }

// 灾害预警规则：与客户端 utils/advisor.js alertsOf 保持一致（那边首页展示，这边推送）
function evalAlerts(days, today) {
  const out = [];
  const f = (days || []).filter(x => x.date > today).slice(0, 10);
  for (let i = 0; i < f.length; i++) {
    let j = i, sum = 0;
    while (j < f.length && f[j].p >= 5) { sum += f[j].p; j++; }
    if (j - i >= 3 && sum >= 30) {
      out.push({ type: 'rain', name: '连阴雨', level: sum >= 60 ? '紧急' : '警惕', start: f[i].date,
        text: md(f[i].date) + '起连阴雨约' + Math.round(sum) + 'mm' });
      break;
    }
  }
  const storm = f.find(x => x.p >= 50);
  if (storm && !out.some(a => a.type === 'rain'))
    out.push({ type: 'rain', name: '暴雨', level: '紧急', start: storm.date, text: md(storm.date) + '暴雨约' + storm.p + 'mm' });
  const frost = f.find(x => x.tmin !== null && x.tmin !== undefined && x.tmin <= 0);
  let drop = null;
  for (let i = 2; i < f.length; i++) if (f[i - 2].t - f[i].t >= 8) { drop = f[i]; break; }
  if (frost || drop) {
    const d = frost || drop;
    out.push({ type: 'frost', name: '霜冻', level: frost && frost.tmin <= -3 ? '警惕' : '注意', start: d.date,
      text: frost ? md(d.date) + '最低' + frost.tmin + '℃有霜冻' : md(d.date) + '前后降温8℃以上' });
  }
  const wind = f.find(x => x.wind >= 10.8);
  if (wind) out.push({ type: 'wind', name: '大风', level: wind.wind >= 13.9 ? '警惕' : '注意', start: wind.date, text: md(wind.date) + '大风' + wind.wind + 'm/s' });
  const m = +today.slice(5, 7);
  if (m >= 5 && m <= 6) {
    const dh = f.find(x => x.tmax >= 32 && x.wind >= 3);
    if (dh) out.push({ type: 'dryHotWind', name: '干热风', level: dh.tmax >= 35 ? '警惕' : '注意', start: dh.date, text: md(dh.date) + '干热风最高' + dh.tmax + '℃' });
  }
  return out;
}

const ALERT_LEVEL = { '注意': '蓝色', '警惕': '黄色', '紧急': '橙色' };

async function sendPush(cfg, openid, kind, data) {
  try {
    const at = await wxAccessToken(cfg);
    const r = await postJSON('https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=' + at, {
      touser: openid, page: PUSH_PAGE,
      template_id: TEMPLATES[kind], miniprogram_state: MINIPROGRAM_STATE, lang: 'zh_CN', data
    });
    if (r.errcode === 0) return { ok: true };
    if (r.errcode === 40001 || r.errcode === 42001) _wxToken = { token: '', exp: 0 }; // token 失效，下次重取
    return { ok: false, errCode: r.errcode, errMsg: String(r.errmsg || '').slice(0, 120) };
  } catch (e) {
    return { ok: false, errCode: -1, errMsg: String(e && e.message || e).slice(0, 120) };
  }
}

// 发送成功：额度 -1 并记 notified 去重标记；43101（用户已无订阅）直接清零额度不再撞墙；
// 其他失败（含 47003 字段不对）不动额度，留日志等人修
async function afterSend(u, kind, r, notifiedPatch, errs) {
  const col = db.collection('users');
  if (r.ok) {
    const upd = { ['subs.' + kind]: _.inc(-1) };
    Object.keys(notifiedPatch || {}).forEach(k => { upd['notified.' + k] = notifiedPatch[k]; });
    await col.doc(u._id).update({ data: upd }).catch(() => null);
    return true;
  }
  if (r.errCode === 43101) await col.doc(u._id).update({ data: { ['subs.' + kind]: 0 } }).catch(() => null);
  else errs.push(kind + '@' + (u._openid || '').slice(-6) + ': ' + (r.errCode || '') + ' ' + r.errMsg);
  return false;
}

// phrase 类型限 5 字且不能含部分符号；character_string 只允许数字/字母/符号（温度用「8~21°」）；
// thing 类型限 20 字
function buildWeather(today, plot, fc) {
  return {
    date1: { value: today },
    phrase2: { value: cut(plot.address || plot.name || '你的地块', 5) },
    phrase3: { value: cut(fc.wx, 5) },
    character_string4: { value: Math.round(fc.tmin) + '~' + Math.round(fc.tmax) + '°' },
    thing6: { value: fc.p >= 1 ? '约' + fc.p + '毫米' : '无降雨' }
  };
}
function buildAlert(today, plot, a) {
  return {
    phrase3: { value: cut(a.name, 5) },
    phrase4: { value: ALERT_LEVEL[a.level] || '蓝色' },
    thing1: { value: cut(a.text, 20) },
    date5: { value: today },
    thing15: { value: cut(plot.name || '地块', 20) }
  };
}
function buildTask(today, t) {
  return {
    thing28: { value: cut((t.ops && t.ops.length ? t.ops.join('、') : '农事作业'), 20) },
    time29: { value: t.dueStart },
    time30: { value: today + ' 06:30:00' },
    thing31: { value: cut(t.title || '农事任务', 20) }
  };
}

async function pushAll(seasonsData, plotMap, today, tomorrow) {
  const summary = { weather: 0, alert: 0, task: 0, errs: [] };
  const users = await db.collection('users').limit(200).get().catch(() => ({ data: [] }));
  const targets = users.data.filter(u => u._openid && u.subs && (u.subs.weather > 0 || u.subs.alert > 0 || u.subs.task > 0));
  if (!targets.length) return summary;
  const cfg = await db.collection('config').doc('wx_msgs').get().then(r => r.data).catch(() => null);
  if (!cfg || !cfg.appid || !cfg.secret) {
    summary.errs.push('config/wx_msgs 缺失（appid+secret），订阅消息未发送');
    return summary;
  }

  // 每个用户取第一块在种地（与首页天气口径一致）
  const fcCache = {};
  for (const u of targets) {
    const s = seasonsData.find(x => { const p = plotMap[x.plotId]; return p && p._openid === u._openid; });
    const plot = s ? plotMap[s.plotId] : null;
    const notified = u.notified || {};

    // ---- 天气提醒 ----
    if (u.subs.weather > 0 && plot && notified.weatherDate !== today) {
      const fc = fcCache[s.plotId] || (fcCache[s.plotId] = await meteo.fetchForecast(plot.lat, plot.lng, 10).catch(() => []));
      const t0 = fc.find(d => d.date === today);
      if (t0 && t0.tmin !== null && t0.tmin !== undefined) {
        const r = await sendPush(cfg, u._openid, 'weather', buildWeather(today, plot, t0));
        if (await afterSend(u, 'weather', r, { weatherDate: today }, summary.errs)) summary.weather++;
      }
    }

    // ---- 灾害预警（同一预警只发一次）----
    if (u.subs.alert > 0 && plot) {
      const fc = fcCache[s.plotId] || (fcCache[s.plotId] = await meteo.fetchForecast(plot.lat, plot.lng, 10).catch(() => []));
      const sent = notified.alerts || {};
      const a = evalAlerts(fc, today).find(x => !sent[x.type + '@' + x.start]);
      if (a) {
        const r = await sendPush(cfg, u._openid, 'alert', buildAlert(today, plot, a));
        if (await afterSend(u, 'alert', r, { ['alerts.' + a.type + '@' + a.start]: today }, summary.errs)) summary.alert++;
      }
    }

    // ---- 日程提醒：明天（含已过期）到期的待办，每人每天 1 条 ----
    if (u.subs.task > 0) {
      const tq = await db.collection('tasks').where({ _openid: u._openid, status: 'open' }).limit(100).get().catch(() => ({ data: [] }));
      const sentT = notified.tasks || {};
      const t = tq.data
        .filter(x => x.dueStart && x.dueStart <= tomorrow && !sentT[x.id + '@' + x.dueStart])
        .sort((a, b) => (a.dueStart < b.dueStart ? -1 : 1))[0];
      if (t) {
        const r = await sendPush(cfg, u._openid, 'task', buildTask(today, t));
        if (await afterSend(u, 'task', r, { ['tasks.' + t.id + '@' + t.dueStart]: today }, summary.errs)) summary.task++;
      }
    }
  }
  return summary;
}

exports.main = async () => {
  const today = meteo.today();
  const tomorrow = meteo.addDays(today, 1);
  const yesterday = meteo.addDays(today, -1);

  // 所有在种的季 → 去重的地块 id
  const seasons = await db.collection('seasons').where({ status: 'growing' }).limit(1000).get()
    .catch(() => ({ data: [] }));
  const plotIds = [];
  seasons.data.forEach(s => { if (s.plotId && plotIds.indexOf(s.plotId) < 0) plotIds.push(s.plotId); });

  const col = db.collection('weather');
  const now = Date.now();
  let updated = 0;
  const plotMap = {};

  for (const plotId of plotIds) {
    const plot = await db.collection('plots').doc(plotId).get().then(r => r.data).catch(() => null);
    if (!plot || plot.lat === undefined || plot.lat === null || plot.lat === '') continue;
    plotMap[plotId] = plot;

    // 已有记录且为 manual 则跳过
    const docId = plotId + '@' + yesterday;
    const exist = await col.doc(docId).get().then(r => r.data).catch(() => null);
    if (exist && exist.src === 'manual') continue;

    const map = await meteo.fetchRange(plot.lat, plot.lng, yesterday, yesterday).catch(() => ({}));
    if (!map[yesterday]) continue;

    await col.doc(docId).set({
      data: { _openid: plot._openid || '', plotId, date: yesterday, t: map[yesterday].t, p: map[yesterday].p, wind: map[yesterday].wind, src: 'api', updatedAt: now }
    }).catch(() => null);
    updated++;
  }
  const push = await pushAll(seasons.data, plotMap, today, tomorrow).catch(e => ({ weather: 0, alert: 0, task: 0, errs: ['pushAll: ' + String(e).slice(0, 120)] }));
  return { ok: true, plots: plotIds.length, updated, push };
};
