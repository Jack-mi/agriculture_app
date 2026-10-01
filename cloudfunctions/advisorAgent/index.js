// 农事参谋 · 多智能体运行时（生产环境）
// Agent loop：模型提议 → schema 校验 → 执行 → 观察 → 继续，封顶 8 轮。
// 写操作只有"起草"：draft_* 工具产出动作草稿，农户在 App 里点确认才落库，模型永远没有直接写权限。
// 设计见 docs/advisor-agents.md。Key 复用 advisorChat 的 config/advisor_ai（不下发客户端）。
const cloud = require('wx-server-sdk');
const https = require('https');
const { DOCS, PESTICIDES, BLOCKED, STAGES } = require('./kb');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COST_CATS = ['agri', 'mach', 'trans', 'labor', 'asset'];
const MATERIAL_TYPES = ['种子', '农药', '化肥', '其他'];

function cfgDoc() {
  return db.collection('config').doc('advisor_ai').get().then(r => r.data).catch(() => null);
}
function postJSON(url, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers) }, res => {
      let buf = '';
      res.on('data', c => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 60000, () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}
function getJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let buf = '';
      res.on('data', c => { buf += c; });
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
const okDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const normAlloc = c => (Array.isArray(c.allocations) && c.allocations.length)
  ? c.allocations.filter(a => a && a.seasonId && (+a.amount || 0) > 0)
  : (c.seasonId && (+c.amount || 0) > 0 ? [{ seasonId: c.seasonId, amount: +c.amount }] : []);

// ---------- 工具实现（全部按 _openid 隔离） ----------
async function impl(openid, name, args, drafts) {
  const a = args || {};
  if (name === 'query_seasons') {
    const [seasons, plots] = await Promise.all([
      db.collection('seasons').where({ _openid: openid }).limit(50).get(),
      db.collection('plots').where({ _openid: openid }).limit(50).get()
    ]);
    const pmap = {};
    plots.data.forEach(p => { pmap[p._id] = p; });
    return seasons.data.map(s => ({
      seasonId: s._id, plot: (pmap[s.plotId] || {}).name || '未知地块', area: (pmap[s.plotId] || {}).area,
      crop: s.crop, variety: s.variety || '', sowDate: s.sowDate, status: s.status,
      harvestDate: s.harvestDate || '', yieldJin: s.yieldJin || ''
    }));
  }
  if (name === 'query_logs') {
    const where = { _openid: openid };
    if (a.seasonId) where.seasonId = a.seasonId;
    const r = await db.collection('logs').where(where).orderBy('date', 'desc').limit(20).get();
    return r.data.map(l => ({ seasonId: l.seasonId, date: l.date, ops: l.ops || [], text: l.text || '', growth: l.growth || '', pest: l.pest || '', machine: l.machine || '', areaMu: l.areaMu || '', materials: l.materials || [], moisture: l.moisture || '' }));
  }
  if (name === 'query_costs') {
    const r = await db.collection('costs').where({ _openid: openid }).orderBy('date', 'desc').limit(100).get();
    return r.data.map(c => ({ seasonAllocations: normAlloc(c), date: c.date, cat: c.cat, sub: c.sub || '', total: normAlloc(c).reduce((s, x) => s + x.amount, 0), note: c.note || '' }));
  }
  if (name === 'query_tasks') {
    const where = { _openid: openid };
    if (a.status) where.status = a.status;
    const r = await db.collection('tasks').where(where).orderBy('dueStart', 'asc').limit(50).get();
    return r.data.map(t => ({ taskId: t._id, seasonId: t.seasonId, title: t.title, dueStart: t.dueStart, dueEnd: t.dueEnd, status: t.status, why: t.why || [] }));
  }
  if (name === 'query_weather') {
    const where = { _openid: openid, plotId: a.plotId };
    if (a.start) where.date = _.gte(a.start);
    if (a.end) where.date = a.start ? _.and(_.gte(a.start), _.lte(a.end)) : _.lte(a.end);
    const r = await db.collection('weather').where(where).orderBy('date', 'desc').limit(40).get();
    return r.data.map(w => ({ date: w.date, t: w.t, p: w.p, wind: w.wind === undefined ? null : w.wind }));
  }
  if (name === 'weather_forecast') {
    const plot = await db.collection('plots').where({ _openid: openid, _id: a.plotId }).limit(1).get().then(r => r.data[0]).catch(() => null);
    if (!plot || plot.lat === undefined || plot.lat === '') return { error: '地块没有定位，查不了预报' };
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + plot.lat + '&longitude=' + plot.lng +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=Asia%2FShanghai&wind_speed_unit=ms&forecast_days=10';
    const j = await getJSON(url);
    const d = j.daily || {};
    return (d.time || []).map((t, i) => ({ date: t, tMin: d.temperature_2m_min[i], tMax: d.temperature_2m_max[i], rain: d.precipitation_sum[i], wind: d.wind_speed_10m_max[i] }));
  }
  if (name === 'kb_search') {
    const q = String(a.query || '');
    const words = q.split(/[^\u4e00-\u9fa5a-zA-Z0-9]+/).filter(w => w.length >= 2);
    const scored = Object.keys(DOCS).map(k => {
      const d = DOCS[k];
      let s = 0;
      const hay = d.title + d.excerpt + (d.tags || []).join('');
      words.forEach(w => { if (hay.indexOf(w) >= 0) s += 2; });
      if (a.crop && (d.crops || []).indexOf(a.crop) >= 0) s += 1;
      return { k, s, d };
    }).filter(x => x.s > 0).sort((x, y) => y.s - x.s).slice(0, 3);
    const prods = PESTICIDES.filter(p => q.indexOf(p.name) >= 0 || q.indexOf(p.target) >= 0).slice(0, 5);
    const blocked = BLOCKED.filter(b => q.indexOf(b.name.replace(/\s/g, '')) >= 0 || q.indexOf('限用') >= 0 || q.indexOf('禁用') >= 0);
    return { docs: scored.map(x => ({ title: x.d.title, org: x.d.org, excerpt: x.d.excerpt })), pesticides: prods, blocked };
  }
  if (name === 'pesticide_check') {
    const n = String(a.name || '').trim();
    const b = BLOCKED.find(x => n.indexOf(x.name.replace(/\s/g, '')) >= 0 || x.name.replace(/\s/g, '').indexOf(n) >= 0);
    if (b) return { level: 'blocked', name: b.name, reason: b.reason };
    const r = PESTICIDES.find(x => n.indexOf(x.name) >= 0 || x.name.indexOf(n) >= 0);
    return r ? Object.assign({ level: 'ok' }, r) : { level: 'unknown', msg: '登记表里没有这个药，以产品标签和当地农资店为准' };
  }
  if (name === 'memory_search') {
    const r = await db.collection('memory').where({ _openid: openid }).limit(30).get();
    return r.data.map(m => ({ id: m._id, text: m.text, kind: m.kind || '' }));
  }
  // ---------- 起草（权限门：只产出草稿动作） ----------
  if (name === 'draft_task') {
    if (!a.seasonId || !a.title || !okDate(a.date)) return { error: '缺 seasonId/title/date（YYYY-MM-DD）' };
    drafts.push({ type: 'task.create', seasonId: a.seasonId, title: String(a.title).slice(0, 30), date: a.date });
    return { drafted: true };
  }
  if (name === 'draft_log') {
    const ids = Array.isArray(a.seasonIds) && a.seasonIds.length ? a.seasonIds : (a.seasonId ? [a.seasonId] : []);
    if (!ids.length || !okDate(a.date)) return { error: '缺 seasonIds/date' };
    drafts.push({
      type: 'log.create',
      log: {
        seasonIds: ids, date: a.date, ops: Array.isArray(a.ops) ? a.ops.slice(0, 5) : [],
        text: String(a.text || '').slice(0, 200), machine: String(a.machine || '').slice(0, 60),
        areaMu: +a.areaMu > 0 ? +a.areaMu : '',
        materials: (Array.isArray(a.materials) ? a.materials : []).filter(m => m && m.name && MATERIAL_TYPES.indexOf(m.type) >= 0)
          .map(m => ({ type: m.type, name: String(m.name).slice(0, 30), rate: +m.rate > 0 ? +m.rate : '', unit: m.unit || '' })).slice(0, 5),
        taskId: a.taskId || ''
      }
    });
    return { drafted: true };
  }
  if (name === 'draft_cost') {
    const ids = Array.isArray(a.seasonIds) && a.seasonIds.length ? a.seasonIds : (a.seasonId ? [a.seasonId] : []);
    if (!ids.length || !(+a.amount > 0) || !okDate(a.date)) return { error: '缺 seasonIds/amount/date' };
    if (COST_CATS.indexOf(a.cat) < 0) return { error: 'cat 只能是 ' + COST_CATS.join('/') };
    drafts.push({
      type: 'cost.create',
      cost: {
        seasonIds: ids, cat: a.cat, sub: String(a.sub || '其他').slice(0, 12), date: a.date,
        money: { mode: a.mode === 'perMu' ? 'perMu' : 'fixed', amount: +a.amount, unitPrice: +a.unitPrice > 0 ? +a.unitPrice : 0, mu: +a.mu > 0 ? +a.mu : 0 },
        note: String(a.note || '').slice(0, 60)
      }
    });
    return { drafted: true };
  }
  if (name === 'memory_save') {
    if (!a.text) return { error: '缺 text' };
    drafts.push({ type: 'memory.add', text: String(a.text).slice(0, 40) });
    return { drafted: true };
  }
  return { error: 'unknown tool: ' + name };
}

// ---------- 工具 schema ----------
const T = (name, description, properties, required) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required: required || [] } }
});
const TOOLS = [
  T('query_seasons', '查农户的种植季列表（地块、作物、品种、播种日、在种/已收获、产量）。回答"我种了什么/哪块地"类问题前先调', {}),
  T('query_logs', '查农事日志（最近 20 条）。"上次啥时候打的药/施的肥"类问题先调', { seasonId: { type: 'string', description: '可选，限定某个种植季' } }),
  T('query_costs', '查成本流水（最近 100 条，含分季分摊金额）。"这季/今年花了多少"类问题先调', {}),
  T('query_tasks', '查待办任务', { status: { type: 'string', description: 'open/done/dismissed，默认全部' } }),
  T('query_weather', '查某地块历史天气（气温/降雨/最大风速 m/s）', { plotId: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' } }, ['plotId']),
  T('weather_forecast', '查某地块未来 10 天天气预报（最高/最低温、降雨、最大风速 m/s）。"明天/这几天能不能打药浇水"先调', { plotId: { type: 'string' } }, ['plotId']),
  T('kb_search', '检索农业技术依据与农药登记（除草/追肥/赤霉病/玉米螟/收获/拌种/灾害等）。农业专业问题先调，按返回的依据回答', { query: { type: 'string' }, crop: { type: 'string', description: 'wheat/corn，可选' } }, ['query']),
  T('pesticide_check', '查某个农药的登记信息或是否限用禁用', { name: { type: 'string' } }, ['name']),
  T('memory_search', '查参谋记住的农户偏好/禁忌', {}),
  T('draft_task', '起草一条待办任务（农户确认后才落库）。只有农户明确要"提醒我/安排任务"时用', { seasonId: { type: 'string' }, title: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' } }, ['seasonId', 'title', 'date']),
  T('draft_log', '起草一条农事日志（农户确认后才落库）。只有农户明确要"记一下/记一笔活"时用', {
    seasonIds: { type: 'array', items: { type: 'string' } }, date: { type: 'string' },
    ops: { type: 'array', items: { type: 'string' }, description: '如 播种/施肥/打药/浇水/机械作业/除草/巡田/病虫害观察/收获' },
    text: { type: 'string' }, machine: { type: 'string' }, areaMu: { type: 'number' },
    materials: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', description: '种子/农药/化肥/其他' }, name: { type: 'string' }, rate: { type: 'number' }, unit: { type: 'string', description: '斤/亩 公斤/亩 株/亩 ml/亩 g/亩' } } } },
    taskId: { type: 'string', description: '可选，保存后同时完成该任务' }
  }, ['seasonIds', 'date']),
  T('draft_cost', '起草一笔账（农户确认后才落库）。只有农户明确要"记一笔钱/账"时用', {
    seasonIds: { type: 'array', items: { type: 'string' }, description: '多季 = 按亩均摊' },
    cat: { type: 'string', description: 'agri 农资/mach 机械/trans 运输/labor 雇工/asset 固定资产' },
    sub: { type: 'string' }, amount: { type: 'number' }, mode: { type: 'string', description: 'perMu = 单价×亩数，可省略' },
    unitPrice: { type: 'number' }, mu: { type: 'number' }, date: { type: 'string' }, note: { type: 'string' }
  }, ['seasonIds', 'cat', 'amount', 'date']),
  T('memory_save', '起草一条参谋要记住的偏好/情况（如"河边地不用 2,4-D"）', { text: { type: 'string' } }, ['text'])
];

function sysPrompt(context) {
  const stageLine = ['wheat', 'corn'].map(c => (c === 'wheat' ? '小麦' : '玉米') + '：' + STAGES[c].map(s => s.name).join('→')).join('\n');
  const today = context.today || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  return '你是「田祖记」的农事参谋，服务对象是胶东种粮大户（冬小麦、夏玉米）。你是庄稼把式 + 合规农技员，说话口语化、说人话。\n' +
    '【今天】' + today + '（农户说"今天/昨天/明天"都按这个日子换算成具体日期）\n' +
    '【铁律】\n' +
    '1. 涉及农户自己的数据（种了啥、干了啥、花了多少、天气、任务），必须先调对应工具拿真实数据再回答，禁止凭印象编。\n' +
    '2. 农业专业问题先 kb_search 拿技术依据再答；拿不准就明说，别编药名和剂量。农药只推登记药剂，剂量按登记区间并提醒看标签。\n' +
    '3. 问答和闲聊不调 draft 工具；只有农户明确要记活/记账/设提醒/让你记住什么，才用 draft_* 起草，并在回复里用一句话说清"给你准备了什么，确认就记上"。\n' +
    '4. 回答直接说话，不要输出 JSON、不要复述工具原始返回。可以说好几句，需要分段用换行。\n' +
    '【生育期顺序】\n' + stageLine + '\n' +
    '【当前上下文】' + JSON.stringify(context);
}

async function callDS(cfg, messages) {
  const base = (cfg.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const body = { model: cfg.model || 'deepseek-flash', messages, tools: TOOLS, tool_choice: 'auto', stream: false };
  const r = await postJSON(base + '/chat/completions', { authorization: 'Bearer ' + cfg.apiKey }, JSON.stringify(body));
  if (r.status !== 200) throw new Error('upstream ' + r.status + ': ' + (r.body || '').slice(0, 200));
  return JSON.parse(r.body);
}

exports.main = async (event) => {
  const cfg = await cfgDoc();
  if (!cfg || !cfg.apiKey) return { ok: false, reason: 'nokey' };
  const openid = (cloud.getWXContext() || {}).OPENID || '';
  if (!openid) return { ok: false, reason: 'noauth' };

  const message = String(event.message || '').trim();
  if (!message && !event.image) return { ok: false, reason: 'badargs' };

  const messages = [{ role: 'system', content: sysPrompt(event.context || {}) }];
  (Array.isArray(event.history) ? event.history : []).slice(-12).forEach(h => {
    if (h && h.content && (h.role === 'user' || h.role === 'assistant')) messages.push({ role: h.role, content: String(h.content).slice(0, 800) });
  });
  const userContent = event.image
    ? [{ type: 'text', text: message || '看看这张照片，地里是什么情况？' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + event.image } }]
    : message;
  messages.push({ role: 'user', content: userContent });

  const drafts = [];
  const toolTrace = [];
  try {
    for (let i = 0; i < 8; i++) {
      const r = await callDS(cfg, messages);
      const msg = r.choices && r.choices[0] && r.choices[0].message;
      if (!msg) return { ok: false, reason: 'empty' };
      const calls = msg.tool_calls || [];
      if (!calls.length) {
        return { ok: true, reply: String(msg.content || ''), actions: drafts, toolTrace };
      }
      messages.push(msg);
      for (const tc of calls) {
        const fn = tc.function || {};
        toolTrace.push(fn.name);
        let args = {};
        try { args = JSON.parse(fn.arguments || '{}'); } catch (e) { args = {}; }
        let res;
        try {
          res = await impl(openid, fn.name, args, drafts);
        } catch (e) {
          res = { error: String(e.message || e).slice(0, 200) };
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(res).slice(0, 4000) });
      }
    }
    return { ok: true, reply: '想了好几圈没理清楚，换个说法再问一次？', actions: drafts, toolTrace };
  } catch (e) {
    return { ok: false, reason: 'model', message: String(e.message || e).slice(0, 300), actions: drafts, toolTrace };
  }
};
