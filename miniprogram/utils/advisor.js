// 农事参谋 · 编排：预报缓存 → 天气预警 → 规则生成/刷新任务 → 视图数据
// 时机：今天页 onShow（每天首次全量）、开季 / 记日志 / 校准 / 对话动作后（该季重算）
// 一期全部在客户端跑；预报走 weatherForecast 云函数（纯本地模式下无预报，只按实况推算）
const U = require('./util.js');
const store = require('./store.js');
const growth = require('./growth.js');
const { RULES } = require('./rules.js');
const kb = require('./kb.js');
const C = require('./const.js');

const FC_KEY = 'guyuji_fc_';
const LEVEL = { now: 0, week: 1, later: 2, soft: 3 };

// ---------- 预报 ----------
function forecastOf(plotId) {
  const c = wx.getStorageSync(FC_KEY + plotId);
  return c && c.days ? c.days : [];
}
function fetchForecast(plot, force) {
  if (!plot || plot.lat === '' || plot.lat === undefined || plot.lat === null) return Promise.resolve([]);
  const c = wx.getStorageSync(FC_KEY + plot.id);
  if (!force && c && c.date === U.today() && c.days && c.days.length) return Promise.resolve(c.days);
  if (!wx.cloud || !wx.cloud.callFunction) return Promise.resolve(c ? c.days || [] : []);
  return wx.cloud.callFunction({ name: 'weatherForecast', data: { lat: plot.lat, lng: plot.lng } })
    .then(r => {
      const days = (r.result && r.result.days) || [];
      if (days.length) wx.setStorageSync(FC_KEY + plot.id, { date: U.today(), days });
      return days;
    })
    .catch(() => (c ? c.days || [] : []));
}

// ---------- 天气预警（只做天气类） ----------
// 返回 [{ type, level:'注意'|'警惕'|'紧急', start, end, text, rule, days:[] }]
function alertsOf(fc) {
  const out = [];
  const f = (fc || []).filter(x => x.date > U.today()).slice(0, 10);
  // 连阴雨：连续 ≥3 天日雨量 ≥5mm 且累计 ≥30mm
  for (let i = 0; i < f.length; i++) {
    let j = i, sum = 0;
    while (j < f.length && f[j].p >= 5) { sum += f[j].p; j++; }
    if (j - i >= 3 && sum >= 30) {
      out.push({ type: 'rain', level: sum >= 60 ? '紧急' : '警惕', start: f[i].date, end: f[j - 1].date, sum: Math.round(sum),
        text: md(f[i].date) + '–' + md(f[j - 1].date) + ' 连阴雨约 ' + Math.round(sum) + 'mm', rule: '连续 ≥3 天日降雨 ≥5mm，且累计 ≥30mm', days: f.slice(i, j) });
      break;
    }
  }
  // 暴雨：单日 ≥50mm
  const storm = f.find(x => x.p >= 50);
  if (storm && !out.some(a => a.type === 'rain')) out.push({ type: 'rain', level: '紧急', start: storm.date, end: storm.date, sum: storm.p, text: md(storm.date) + ' 暴雨约 ' + storm.p + 'mm', rule: '单日降雨 ≥50mm', days: [storm] });
  // 降温霜冻：最低温 ≤0℃，或 48 小时内日均温降 ≥8℃
  const frost = f.find(x => x.tmin !== null && x.tmin !== undefined && x.tmin <= 0);
  let drop = null;
  for (let i = 2; i < f.length; i++) if (f[i - 2].t - f[i].t >= 8) { drop = f[i]; break; }
  if (frost || drop) {
    const d = frost || drop;
    out.push({ type: 'frost', level: frost && frost.tmin <= -3 ? '警惕' : '注意', start: d.date, end: d.date,
      text: frost ? md(d.date) + ' 最低 ' + frost.tmin + '℃，有霜冻' : md(d.date) + ' 前后降温 8℃ 以上', rule: '最低气温 ≤0℃，或 48 小时降温 ≥8℃', days: [d] });
  }
  // 大风：日最大风速 ≥10.8 m/s（6 级）
  const wind = f.find(x => x.wind >= 10.8);
  if (wind) out.push({ type: 'wind', level: wind.wind >= 13.9 ? '警惕' : '注意', start: wind.date, end: wind.date, text: md(wind.date) + ' 大风 ' + wind.wind + 'm/s', rule: '日最大风速 ≥10.8m/s（6 级）', days: [wind] });
  // 干热风：最高温 ≥32℃ 且风速 ≥3m/s（5–6 月）
  const m = +U.today().slice(5, 7);
  if (m >= 5 && m <= 6) {
    const dh = f.find(x => x.tmax >= 32 && x.wind >= 3);
    if (dh) out.push({ type: 'dryHotWind', level: dh.tmax >= 35 ? '警惕' : '注意', start: dh.date, end: dh.date, text: md(dh.date) + ' 干热风（最高 ' + dh.tmax + '℃）', rule: '最高气温 ≥32℃ 且风速 ≥3m/s', days: [dh] });
  }
  return out;
}
function md(d) { return (+d.slice(5, 7)) + '月' + (+d.slice(8)) + '日'; }

// ---------- 任务刷新 ----------
function ctxOf(season, fc) {
  const plot = store.plots.get(season.plotId) || {};
  const logs = store.logs.bySeason(season.id);
  const st = growth.current(season, fc);
  return {
    season, plot, st, fc, alerts: alertsOf(fc), logs, U,
    lastLogOf(ops) { return logs.find(l => !ops || (l.ops || []).some(o => ops.indexOf(o) >= 0)) || null; }
  };
}

// 对一个在种季跑规则：新增 / 更新 open 任务；不再命中的 open 规则任务 → expired；用户改过日期的保留其日期
function refreshSeason(season, fc) {
  if (!season || season.status !== 'growing') return 0;
  fc = fc || forecastOf(season.plotId);
  const ctx = ctxOf(season, fc);
  const today = U.today();
  const hit = {};
  const list = [];
  RULES.forEach(r => {
    if (r.crop !== '*' && r.crop !== season.crop) return;
    if (store.memory.suppressed(r.key, season.plotId)) return;
    const out = r.test(ctx);
    if (!out) return;
    const id = season.id + '#' + r.key;
    hit[id] = true;
    const cur = store.tasks.get(id);
    if (cur && (cur.status === 'done' || cur.status === 'dismissed')) return;
    const t = {
      id, seasonId: season.id, plotId: season.plotId, key: r.key, source: r.source, title: out.title,
      why: out.why || [], steps: out.steps || [], ref: out.ref || '', ops: out.ops || [], matType: out.matType || '', target: out.target || '',
      level: out.level || 'week', status: 'open'
    };
    if (cur && cur.userDue) { t.dueStart = cur.dueStart; t.dueEnd = cur.dueEnd; }
    else { t.dueStart = out.due[0]; t.dueEnd = out.due[1] < out.due[0] ? out.due[0] : out.due[1]; }
    list.push(t);
  });
  // 过期：规则任务不再命中且窗口已过 → expired；人建 / 参谋建议任务过了截止 3 天 → expired
  store.tasks.bySeason(season.id).forEach(t => {
    if (t.status !== 'open') return;
    const isRule = ['stage', 'weather', 'record'].indexOf(t.source) >= 0;
    if (isRule && !hit[t.id] && !t.userDue) list.push({ id: t.id, status: 'expired' });
    else if (t.dueEnd && U.diffDays(t.dueEnd, today) > 3) list.push({ id: t.id, status: 'expired' });
  });
  return store.tasks.putMany(list);
}

function refreshAll(force) {
  const seasons = store.seasons.growing();
  return Promise.all(seasons.map(s => fetchForecast(store.plots.get(s.plotId), force).then(fc => refreshSeason(s, fc)).catch(() => refreshSeason(s))))
    .then(r => r.reduce((a, b) => a + (b || 0), 0));
}

// ---------- 视图 ----------
function bucketOf(t) {
  const today = U.today();
  if (t.level === 'soft') return 'soft';
  if (t.level === 'now' || (t.dueEnd && t.dueEnd <= U.addDays(today, 1))) return 'now';
  if (t.dueStart && t.dueStart > U.addDays(today, 7)) return 'later';
  return 'week';
}
function dueText(t) {
  const today = U.today();
  if (!t.dueEnd) return '';
  if (t.dueStart > today) {
    const n = U.diffDays(today, t.dueStart);
    return n > 7 ? '约 ' + md(t.dueStart) : md(t.dueStart) + ' 起';
  }
  if (t.dueEnd < today) return '已过 ' + md(t.dueEnd);
  if (t.dueEnd === today) return '今天';
  if (t.dueEnd === U.addDays(today, 1)) return '明天前';
  return md(t.dueEnd) + '前';
}
const SRC = { stage: '生育期', weather: '天气预警', record: '你的记录', user: '你说的', advice: '参谋建议' };
function taskView(t) {
  const s = store.seasons.get(t.seasonId) || {};
  const p = store.plots.get(t.plotId) || {};
  const b = bucketOf(t);
  return {
    id: t.id, title: t.title, bucket: b, due: dueText(t), src: SRC[t.source] || '参谋', source: t.source,
    plot: p.name || '', crop: C.cropOf(s.crop).name, variety: s.variety || '', area: p.area || 0, status: t.status
  };
}
function sortTasks(a, b) {
  const la = LEVEL[bucketOf(a)], lb = LEVEL[bucketOf(b)];
  if (la !== lb) return la - lb;
  return (a.dueEnd || '9') < (b.dueEnd || '9') ? -1 : 1;
}

// 今天页
function today() {
  const open = store.tasks.open().filter(t => { const s = store.seasons.get(t.seasonId); return s && s.status === 'growing'; }).sort(sortTasks);
  const views = open.map(taskView);
  const soft = views.filter(v => v.bucket === 'soft');
  const now = views.filter(v => v.bucket === 'now');
  const week = views.filter(v => v.bucket === 'week');
  const later = views.filter(v => v.bucket === 'later');
  // 预警：合并所有在种地块的预警，写明影响哪些地
  const alerts = [];
  store.seasons.growing().forEach(s => {
    const p = store.plots.get(s.plotId) || {};
    alertsOf(forecastOf(s.plotId)).forEach(a => {
      const k = a.type + a.start;
      let hit = alerts.find(x => x.key === k);
      if (!hit) { hit = Object.assign({ key: k, plots: [] }, a); alerts.push(hit); }
      const st = growth.current(s).stage;
      hit.plots.push(p.name + '（' + st.name.replace('期', '') + C.cropOf(s.crop).name + '）');
    });
  });
  // 下一件：最近的"往后"任务
  const nextTask = later[0] || null;
  // 各在种季的生育期小卡
  const stages = store.seasons.growing().map(s => {
    const p = store.plots.get(s.plotId) || {};
    const cur = growth.current(s, forecastOf(s.plotId));
    return { id: s.id, plot: p.name, crop: C.cropOf(s.crop).name, cls: C.cropOf(s.crop).cls, icon: C.cropOf(s.crop).icon, stage: cur.stage.name, pct: cur.overall, dayN: U.diffDays(s.sowDate, U.today()) + 1 };
  });
  return { now, week, later, soft, alerts, nextTask, stages, count: now.length + week.length };
}

// 单季「参谋」标签页
function seasonPanel(season) {
  const fc = forecastOf(season.plotId);
  const cur = growth.current(season, fc);
  const logs = store.logs.bySeason(season.id);
  const lastGrowth = logs.find(l => l.growth) || logs.find(l => (l.ops || []).indexOf('巡田') >= 0 && l.text);
  const tasks = store.tasks.bySeason(season.id).filter(t => t.status === 'open').sort(sortTasks).map(taskView);
  const alerts = alertsOf(fc);
  return {
    stage: cur.stage.name, stageKey: cur.stage.key, gdd: cur.gdd, pct: cur.pct, overall: cur.overall,
    next: cur.next ? cur.next.name : '', eta: cur.eta ? md(cur.eta) : '', etaSpan: cur.etaSpan,
    bar: cur.list.map((s, i) => ({ name: s.name.replace('期', ''), on: i < cur.idx, cur: i === cur.idx })),
    calibrated: cur.calibrated, varietyKnown: cur.varietyKnown, variety: season.variety || '', missing: cur.missing,
    growthText: lastGrowth ? (lastGrowth.growth || lastGrowth.text) : '', growthDate: lastGrowth ? md(lastGrowth.date) : '',
    alert: alerts[0] || null, tasks
  };
}

// 任务详情
function taskDetail(id) {
  const t = store.tasks.get(id);
  if (!t) return null;
  const v = taskView(t);
  const doc = kb.get(t.ref);
  return Object.assign(v, {
    why: t.why || [], steps: t.steps || [], doc, ops: t.ops || [], matType: t.matType || '', target: t.target || '',
    seasonId: t.seasonId, plotId: t.plotId, cropKey: (store.seasons.get(t.seasonId) || {}).crop, reason: t.reason || ''
  });
}

// 季内事件后重算（记日志 / 校准 / 开季）
function onSeasonChanged(seasonId) {
  const s = store.seasons.get(seasonId);
  if (s) refreshSeason(s);
}

// 保存日志后：若由任务进入，完成该任务；并重算该季（巡田等规则会自动消失）
function onLogSaved(log, taskId) {
  if (taskId) store.tasks.complete(taskId, log.id, log.date);
  onSeasonChanged(log.seasonId);
}

module.exports = { fetchForecast, forecastOf, alertsOf, refreshSeason, refreshAll, today, seasonPanel, taskDetail, taskView, bucketOf, dueText, onSeasonChanged, onLogSaved, md, SRC };
