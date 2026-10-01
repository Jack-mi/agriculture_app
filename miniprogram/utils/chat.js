// 跟参谋说 · 对话引擎（纯大模型，无本地规则）
// 链路：chat.ask → advisorAgent 云函数（DeepSeek tool-calling 多智能体）→ 动作草稿 → fromLLM 白名单转确认卡 → 农户确认 → execute 写数据
// AI 永远不直接改数据：所有写操作只发生在 execute(card)
const U = require('./util.js');
const C = require('./const.js');
const store = require('./store.js');
const growth = require('./growth.js');
const advisor = require('./advisor.js');
const pesticide = require('./pesticide.js');
const weather = require('./weather.js');

const ACTIONS = ['plot.create', 'plot.update', 'plot.remove', 'plot.locate', 'season.create', 'season.harvest', 'season.remove', 'season.variety', 'task.create', 'task.update', 'task.dismiss', 'task.complete', 'log.create', 'log.remove', 'cost.create', 'cost.remove', 'tag.cost', 'tag.log', 'weather.set', 'stage.calibrate', 'memory.add', 'memory.remove'];

// ---------- 上下文 ----------
// ctx: { taskId?, seasonId? } → 解析出 task / season / plot
function resolveCtx(ctx) {
  ctx = ctx || {};
  const task = ctx.taskId ? store.tasks.get(ctx.taskId) : null;
  const seasonId = (task && task.seasonId) || ctx.seasonId || '';
  const season = seasonId ? store.seasons.get(seasonId) : null;
  const plot = season ? store.plots.get(season.plotId) : null;
  return { task, season, plot };
}
function plotName(season) { const p = store.plots.get(season.plotId) || {}; return p.name || ''; }

let seq = 0;
function cid() { seq += 1; return 'card_' + Date.now().toString(36) + '_' + seq; }

// 操作类型识别（仅用于任务卡片展示与天气提醒，不参与理解）
const OP_WORDS = [
  ['打药', /打药|喷药|飞防|防治/],
  ['机械作业', /机械|无人机|机收|旋耕|犁地/],
  ['施肥', /施肥|追肥|撒肥/],
  ['浇水', /浇水|灌溉|浇地/],
  ['除草', /除草|打草|化除/],
  ['播种', /播种|下种|补种/],
  ['收获', /收获|收割|抢收/],
  ['巡田', /巡田|查苗/]
];
function matchOps(text) {
  const t = String(text || '');
  return OP_WORDS.filter(([, re]) => re.test(t)).map(([n]) => n);
}

// ---------- 卡片构造（确认卡全部走这里） ----------
function cardTaskCreate(season, title, date, opts) {
  opts = opts || {};
  const d = date || U.addDays(U.today(), 1);
  const ops = matchOps(title);
  const rows = ['日期 ' + advisor.md(d) + ' · 来源：' + (opts.source === 'advice' ? '参谋建议' : '你说的')];
  const fc = advisor.forecastOf(season.plotId).find(f => f.date === d);
  let warn = '';
  if (fc && fc.p >= 2 && ops.some(o => ['打药', '除草', '施肥'].indexOf(o) >= 0)) warn = advisor.md(d) + ' 预报有雨（' + fc.p + 'mm），打药后 6 小时内下雨要补喷，可以提前一天';
  const next = advisor.forecastOf(season.plotId).find(f => f.date === U.addDays(d, 1));
  if (!warn && next && next.p >= 2 && ops.some(o => ['打药', '除草'].indexOf(o) >= 0)) warn = advisor.md(next.date) + ' 预报有小雨，' + advisor.md(d) + ' 上午打比较稳妥';
  return { id: cid(), type: 'task.create', tag: opts.source === 'advice' ? '建议' : '新任务', tagCls: 'org', title: plotName(season) + ' · ' + title, rows: rows.concat(opts.rows || []), warn, ok: opts.source === 'advice' ? '加成任务' : '加上',
    payload: { seasonId: season.id, title, dueStart: d, dueEnd: opts.dueEnd || d, ops, source: opts.source || 'user', why: opts.why || [], steps: opts.steps || [], ref: opts.ref || '', matType: opts.matType || '', target: opts.target || '', key: opts.key || '' } };
}
function cardTaskUpdate(task, date, extra) {
  const oldTxt = advisor.dueText(task);
  return { id: cid(), type: 'task.update', tag: '改任务', tagCls: 'red', title: task.title,
    rows: [{ old: oldTxt, now: advisor.md(date) }].concat(extra || []), ok: '确认',
    payload: { taskId: task.id, dueStart: date, dueEnd: date } };
}
function cardTaskDismiss(task, reason, remember) {
  return { id: cid(), type: 'task.dismiss', tag: '不做了', tagCls: 'gry', title: task.title,
    rows: [reason ? '原因：' + reason : '从待办里去掉', remember ? '以后这块地不再推这类任务' : ''].filter(Boolean), ok: '确认去掉',
    payload: { taskId: task.id, reason: reason || '', remember: !!remember } };
}
function cardLog(seasons, draft, taskId) {
  const date = draft.date || U.today();
  const areaTxt = seasons.map(s => { const p = store.plots.get(s.plotId) || {}; return p.name + (p.area ? ' ' + p.area + '亩' : ''); }).join(' · ');
  const mats = (draft.materials || []).map(m => (m.type === '农药' ? '农药：' : m.type === '化肥' ? '肥料：' : '') + m.name + ' ' + (m.rate ? m.rate + ' ' + (m.unit || '') : '? ' + (m.unit || '/亩')));
  const rows = [areaTxt];
  const detail = [draft.machine ? '机械：' + draft.machine : '', mats.join('、')].filter(Boolean).join(' · ');
  if (detail) rows.push(detail);
  if (draft.text) rows.push('「' + draft.text.slice(0, 40) + '」');
  const warn = (draft.materials || []).map(m => m.type === '农药' ? pesticide.check(seasons[0].crop, m.name, m.rate, m.unit) : null).filter(c => c && c.level === 'warn').map(c => c.msg)[0] || '';
  if (taskId) { const t = store.tasks.get(taskId); if (t) rows.push('保存后「' + t.title + '」完成'); }
  return { id: cid(), type: 'log.create', tag: '记事', tagCls: 'blu', title: advisor.md(date) + ' · ' + ((draft.ops || []).join(' · ') || '记事'), rows, warn, ok: '记上',
    payload: { seasonIds: seasons.map(s => s.id), date, ops: draft.ops || [], text: draft.text || '', machine: draft.machine || '', materials: draft.materials || [], areaMu: draft.areaMu || '', taskId: taskId || '' } };
}
function cardCost(seasons, money, draft) {
  const date = draft.date || U.today();
  const ids = seasons.map(s => s.id);
  const sub = draft.sub || '其他';
  let total = money.amount || 0, calc = null;
  if (money.mode === 'perMu') {
    const mu = money.mu > 0 ? money.mu : store.costs.areaOf(ids);
    total = Math.round(money.unitPrice * mu * 100) / 100;
    calc = { mode: 'perMu', unitPrice: money.unitPrice, mu };
  } else if (money.mode === 'perDay') {
    total = Math.round(money.unitPrice * money.people * 100) / 100;
    calc = { mode: 'perDay', unitPrice: money.unitPrice, people: money.people };
  }
  const allocs = ids.length > 1 ? store.costs.allocByArea(total, ids) : [{ seasonId: ids[0], amount: total }];
  const rows = [calc && calc.mode === 'perMu' ? '¥' + U.money(calc.unitPrice) + '/亩 × ' + calc.mu + '亩 = ¥' + U.money(total)
    : calc && calc.mode === 'perDay' ? calc.people + '人 × ¥' + U.money(calc.unitPrice) + ' = ¥' + U.money(total) : '¥' + U.money(total)];
  if (allocs.length > 1) rows.push('按亩均摊：' + allocs.map(a => plotName(store.seasons.get(a.seasonId)).slice(0, 4) + ' ¥' + U.money(a.amount)).join(' · '));
  return { id: cid(), type: 'cost.create', tag: '记账', tagCls: 'org', title: C.catOf(draft.cat).name + ' · ' + sub, rows, ok: '记上',
    payload: { date, cat: draft.cat, sub, allocations: allocs, calc, split: allocs.length > 1 ? 'area' : '', note: draft.note || '' } };
}
function cardCalib(season, stageKey) {
  const cur = growth.current(season, advisor.forecastOf(season.plotId));
  const target = cur.list.find(s => s.key === stageKey);
  if (!target) return null;
  const perDay = growth.dayGdd(season.crop, (store.weather.get(season.plotId, U.addDays(U.today(), -1)) || {}).t || 12) || 8;
  const days = Math.round((target.gdd - cur.gdd) / perDay);
  const diff = days === 0 ? '和推算一致' : days > 0 ? '比推算早约 ' + days + ' 天' : '比推算晚约 ' + (-days) + ' 天';
  return { id: cid(), type: 'stage.calibrate', tag: '校准', tagCls: 'blu', title: '生育期 · ' + plotName(season),
    rows: [{ old: cur.stage.name, now: target.name }, diff + '，后面的阶段和任务一起调整'], ok: '按' + target.name + '校准',
    payload: { seasonId: season.id, stage: stageKey } };
}
function cardMemAdd(text, season) {
  return { id: cid(), type: 'memory.add', tag: '记住', tagCls: 'blu', title: text, rows: ['以后出建议时会参考这条'], ok: '记住',
    payload: { text, plotId: season ? season.plotId : '', seasonId: season ? season.id : '' } };
}
function cardMemRemove(m) {
  return { id: cid(), type: 'memory.remove', tag: '忘掉', tagCls: 'gry', title: m.text, rows: ['以后不再参考这条'], ok: '确认忘掉', payload: { id: m.id } };
}
function cardPlotCreate(name, area, address) {
  return { id: cid(), type: 'plot.create', tag: '新地块', tagCls: 'org', title: name + ' · ' + area + '亩',
    rows: [address ? '位置：' + address : '位置先空着，之后可以在地块页补定位'], ok: '建上',
    payload: { name, area: +area, address: address || '' } };
}
function cardPlotUpdate(plot, name, area) {
  const rows = [];
  if (name && name !== plot.name) rows.push({ old: plot.name, now: name });
  if (+area > 0 && +area !== +plot.area) rows.push({ old: (plot.area || '?') + '亩', now: area + '亩' });
  return { id: cid(), type: 'plot.update', tag: '改地块', tagCls: 'org', title: plot.name,
    rows: rows.length ? rows : ['没有要改的'], ok: '确认',
    payload: { plotId: plot.id, name: name || '', area: +area > 0 ? +area : '' } };
}
function cardPlotRemove(plot) {
  return { id: cid(), type: 'plot.remove', tag: '删地块', tagCls: 'red', title: plot.name,
    rows: ['这块地下的种植季、账、记事会一起删掉，不能恢复'], ok: '确认删除', warn: '删了找不回来',
    payload: { plotId: plot.id } };
}
function cardSeasonCreate(plot, crop, sowDate, variety, seedRate) {
  const rows = ['播种 ' + advisor.md(sowDate), variety ? '品种 ' + variety : '', seedRate ? '播量 ' + seedRate + '斤/亩' : ''].filter(Boolean);
  return { id: cid(), type: 'season.create', tag: '开季', tagCls: 'org', title: plot.name + ' · ' + C.cropOf(crop).name,
    rows, ok: '开季',
    payload: { plotId: plot.id, crop, sowDate, variety: variety || '', seedRate: seedRate || '' } };
}
function cardHarvest(season, date, yieldJin, note) {
  const plot = store.plots.get(season.plotId) || {};
  const rows = ['收获日 ' + advisor.md(date), yieldJin ? '产量 ' + yieldJin + '斤' : '产量先不填', note || ''].filter(Boolean);
  return { id: cid(), type: 'season.harvest', tag: '收获', tagCls: 'org', title: (plot.name || '这块地') + ' · ' + C.cropOf(season.crop).name,
    rows, ok: '记上收获', payload: { seasonId: season.id, date, yieldJin: yieldJin || '', note: note || '' } };
}
function cardSeasonRemove(season) {
  const plot = store.plots.get(season.plotId) || {};
  return { id: cid(), type: 'season.remove', tag: '删季', tagCls: 'red', title: (plot.name || '') + ' · ' + C.cropOf(season.crop).name,
    rows: ['这一季的账、记事、任务会一起删掉，不能恢复'], ok: '确认删除', warn: '删了找不回来',
    payload: { seasonId: season.id } };
}
function cardVariety(season, variety) {
  const plot = store.plots.get(season.plotId) || {};
  return { id: cid(), type: 'season.variety', tag: '改品种', tagCls: 'org', title: (plot.name || '这块地') + ' · ' + C.cropOf(season.crop).name,
    rows: [{ old: season.variety || '未填', now: variety }], ok: '改上',
    payload: { seasonId: season.id, variety } };
}
function cardLogRemove(log) {
  const s = store.seasons.get(log.seasonId);
  const plot = s ? (store.plots.get(s.plotId) || {}) : {};
  return { id: cid(), type: 'log.remove', tag: '删记事', tagCls: 'red', title: advisor.md(log.date) + ' · ' + ((log.ops || []).join('·') || '记事'),
    rows: [(plot.name || '记事') + (log.text ? ' 「' + String(log.text).slice(0, 24) + '」' : '')], ok: '确认删除', warn: '删了找不回来',
    payload: { logId: log.id } };
}
function cardCostRemove(cost) {
  return { id: cid(), type: 'cost.remove', tag: '删账', tagCls: 'red', title: C.catOf(cost.cat).name + ' · ' + (cost.sub || ''),
    rows: [advisor.md(cost.date) + ' · ¥' + U.money(cost.amount)], ok: '确认删除', warn: '删了找不回来',
    payload: { costId: cost.id } };
}
function cardLocate(plot) {
  return { id: cid(), type: 'plot.locate', tag: '选位置', tagCls: 'blu', title: plot.name,
    rows: ['确认后打开地图，点一下这块地的位置'], ok: '去选点', payload: { plotId: plot.id } };
}
function cardCostTag(cat, name) {
  return { id: cid(), type: 'tag.cost', tag: '记账类型', tagCls: 'org', title: C.catOf(cat).name + ' · ' + name,
    rows: ['加到记账细分类型里'], ok: '加上', payload: { cat, name } };
}
function cardLogTag(name) {
  return { id: cid(), type: 'tag.log', tag: '记事类型', tagCls: 'blu', title: name,
    rows: ['加到记事类型里'], ok: '加上', payload: { name } };
}
function cardWeather(plot, date, t, p, wind) {
  const rows = [advisor.md(date) + ' · ' + t + '℃ · 降雨 ' + p + 'mm'];
  if (wind !== '' && wind !== undefined && !isNaN(+wind)) rows.push('风速 ' + wind + ' m/s');
  return { id: cid(), type: 'weather.set', tag: '改天气', tagCls: 'blu', title: plot.name,
    rows, ok: '按这个改', payload: { plotId: plot.id, date, t: +t, p: +p, wind: wind === '' || wind === undefined ? '' : +wind } };
}
function cardTaskDone(task) {
  return { id: cid(), type: 'task.complete', tag: '完成', tagCls: 'blu', title: task.title,
    rows: ['标成已完成'], ok: '确认完成', payload: { taskId: task.id, date: U.today() } };
}

// ---------- 动作 → 确认卡（白名单校验 + 结构化草稿） ----------
function fromLLM(json, ctx) {
  const rc = resolveCtx(ctx);
  const out = { reply: String(json.reply || '').slice(0, 1500), cards: [], chips: [] };
  (json.actions || []).forEach(a => {
    if (!a || ACTIONS.indexOf(a.type) < 0) return;
    try {
      if (a.type === 'plot.create') {
        const name = String(a.name || '').trim().slice(0, 20);
        if (!name || !(+a.area > 0)) return;
        out.cards.push(cardPlotCreate(name, +a.area, String(a.address || '').slice(0, 40)));
      } else if (a.type === 'plot.update') {
        const plot = store.plots.get(a.plotId); if (!plot) return;
        const name = String(a.name || '').trim().slice(0, 20);
        const area = +a.area > 0 ? +a.area : '';
        if ((!name || name === plot.name) && (!area || area === +plot.area)) return;
        out.cards.push(cardPlotUpdate(plot, name, area));
      } else if (a.type === 'plot.remove') {
        const plot = store.plots.get(a.plotId); if (!plot) return;
        out.cards.push(cardPlotRemove(plot));
      } else if (a.type === 'season.create') {
        const plot = store.plots.get(a.plotId); if (!plot || !valid(a.sowDate)) return;
        if (a.crop !== 'wheat' && a.crop !== 'corn') return;
        if (store.seasons.current(plot.id)) return;
        out.cards.push(cardSeasonCreate(plot, a.crop, a.sowDate, String(a.variety || '').slice(0, 20), +a.seedRate > 0 ? +a.seedRate : ''));
      } else if (a.type === 'season.harvest') {
        const s = store.seasons.get(a.seasonId) || rc.season; if (!s || s.status === 'done' || !valid(a.date)) return;
        out.cards.push(cardHarvest(s, a.date, +a.yieldJin > 0 ? +a.yieldJin : '', String(a.note || '').slice(0, 80)));
      } else if (a.type === 'season.remove') {
        const s = store.seasons.get(a.seasonId); if (!s) return;
        out.cards.push(cardSeasonRemove(s));
      } else if (a.type === 'season.variety') {
        const s = store.seasons.get(a.seasonId) || rc.season; if (!s) return;
        const variety = String(a.variety || '').trim().slice(0, 20);
        if (!variety || variety === (s.variety || '')) return;
        out.cards.push(cardVariety(s, variety));
      } else if (a.type === 'log.remove') {
        const log = store.logs.get(a.logId); if (!log) return;
        out.cards.push(cardLogRemove(log));
      } else if (a.type === 'cost.remove') {
        const cost = store.costs.get(a.costId); if (!cost) return;
        out.cards.push(cardCostRemove(cost));
      } else if (a.type === 'plot.locate') {
        const plot = store.plots.get(a.plotId); if (!plot) return;
        out.cards.push(cardLocate(plot));
      } else if (a.type === 'tag.cost') {
        const name = String(a.name || '').trim().slice(0, 12);
        if (!name || ['agri', 'mach', 'trans', 'labor', 'asset'].indexOf(a.cat) < 0) return;
        out.cards.push(cardCostTag(a.cat, name));
      } else if (a.type === 'tag.log') {
        const name = String(a.name || '').trim().slice(0, 12);
        if (!name) return;
        out.cards.push(cardLogTag(name));
      } else if (a.type === 'weather.set') {
        const plot = store.plots.get(a.plotId); if (!plot || !valid(a.date)) return;
        if (a.t === undefined || a.t === '' || a.p === undefined || a.p === '' || isNaN(+a.t) || isNaN(+a.p)) return;
        out.cards.push(cardWeather(plot, a.date, a.t, a.p, a.wind));
      } else if (a.type === 'task.complete') {
        const task = store.tasks.get(a.taskId) || rc.task; if (!task || task.status === 'done') return;
        out.cards.push(cardTaskDone(task));
      } else if (a.type === 'task.create') {
        const s = store.seasons.get(a.seasonId) || rc.season; if (!s || !a.title) return;
        out.cards.push(cardTaskCreate(s, String(a.title).slice(0, 30), valid(a.date) || U.addDays(U.today(), 1)));
      } else if (a.type === 'task.update') {
        const task = store.tasks.get(a.taskId) || rc.task; if (!task || !valid(a.date)) return;
        out.cards.push(cardTaskUpdate(task, a.date));
      } else if (a.type === 'task.dismiss') {
        const task = store.tasks.get(a.taskId) || rc.task; if (!task) return;
        out.cards.push(cardTaskDismiss(task, String(a.reason || '').slice(0, 30), !!a.remember));
      } else if (a.type === 'stage.calibrate') {
        const s = store.seasons.get(a.seasonId) || rc.season; if (!s) return;
        const known = (growth.STAGES[s.crop] || []).some(x => x.key === a.stage);
        const stage = known ? a.stage : growth.stageByName(s.crop, a.stage);
        const c = cardCalib(s, stage); if (c) out.cards.push(c);
      } else if (a.type === 'memory.add') {
        if (a.text) out.cards.push(cardMemAdd(String(a.text).slice(0, 40), rc.season));
      } else if (a.type === 'memory.remove') {
        const m = store.memory.get(a.id); if (m) out.cards.push(cardMemRemove(m));
      } else if (a.type === 'log.create' && a.log) {
        // 结构化草稿（agent 产出），不再经本地解析复核
        const l = a.log;
        const ids = (l.seasonIds || []).length ? l.seasonIds : (rc.season ? [rc.season.id] : []);
        const seasons = ids.map(id => store.seasons.get(id)).filter(Boolean);
        if (!seasons.length || !valid(l.date)) return;
        out.cards.push(cardLog(seasons, l, l.taskId || ''));
      } else if (a.type === 'cost.create' && a.cost) {
        const cst = a.cost;
        const ids = (cst.seasonIds || []).length ? cst.seasonIds : (rc.season ? [rc.season.id] : []);
        const seasons = ids.map(id => store.seasons.get(id)).filter(Boolean);
        if (!seasons.length || !valid(cst.date)) return;
        const money = cst.money || { mode: 'fixed', amount: 0 };
        if (!(+money.amount > 0) && !(money.mode === 'perMu' && +money.unitPrice > 0)) return;
        out.cards.push(cardCost(seasons, money, cst));
      }
    } catch (e) { /* 丢弃不合法动作 */ }
  });
  return out;
}
function valid(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : ''; }

// ---------- 模型选择（我的页可切；实际模型以云端 config 为准） ----------
const AI_MODELS = [
  { key: 'byok', label: 'DeepSeek V4.1 Flash（快）', model: 'deepseek-flash' },
  { key: 'byokpro', label: 'DeepSeek V4 Pro（强，更贵更慢）', model: 'deepseek-v4-pro' }
];
const AI_MODEL_KEY = 'guyuji_ai_model';
function modelChoice() {
  try {
    const k = wx.getStorageSync(AI_MODEL_KEY);
    const m = AI_MODELS.find(x => x.key === k);
    if (m) return m;
  } catch (e) {}
  return AI_MODELS[0];
}

// ---------- 问与答（唯一入口：advisorAgent 云函数，纯模型，无规则兜底） ----------
function lightContext(ctx) {
  const rc = resolveCtx(ctx);
  return {
    today: U.today(),
    task: rc.task ? { id: rc.task.id, title: rc.task.title, due: rc.task.dueStart } : null,
    plots: store.plots.all().map(p => ({ plotId: p.id, name: p.name, area: p.area, growingSeasonId: (store.seasons.current(p.id) || {}).id || '' })),
    seasons: store.seasons.growing().map(s => ({ seasonId: s.id, plotId: s.plotId, plot: plotName(s), crop: C.cropOf(s.crop).name, variety: s.variety || '', stage: growth.current(s).stage.name })),
    memory: store.memory.all().map(m => ({ id: m.id, text: m.text }))
  };
}
function askAgent(text, ctx, imageBase64, history) {
  const cf = typeof wx !== 'undefined' && wx.cloud && wx.cloud.callFunction;
  if (!cf) return Promise.resolve({ reply: '参谋需要联网 + 云开发环境才能干活。', cards: [], chips: [] });
  return cf({ name: 'advisorAgent', data: { message: text, image: imageBase64 || undefined, context: lightContext(ctx), history: history || [] } }).then(r => {
    const res = r && r.result;
    if (!res) return { reply: '参谋暂时连不上，稍后再试。', cards: [], chips: [] };
    if (!res.ok) {
      if (res.reason === 'nokey') return { reply: '参谋还没配上模型 Key。云端那份 DeepSeek Key 是空的，配好才能聊。', cards: [], chips: [] };
      return { reply: '参谋脑子卡了一下（' + (res.reason || '网络') + '），再说一次？', cards: [], chips: [] };
    }
    const out = fromLLM({ reply: res.reply, actions: res.actions || [] }, ctx);
    if (!out.reply && !out.cards.length) out.reply = '嗯，我在。想问啥直接说。';
    out.reasoning = String(res.reasoning || '').slice(0, 4000);
    return out;
  }).catch(() => ({ reply: '网络不太好，参谋没接上线，稍后再试。', cards: [], chips: [] }));
}
function ask(text, ctx, pending, history) { return askAgent(text, ctx, null, history); }
function askImage(text, imageBase64, ctx) { return askAgent(text || '', ctx, imageBase64, null); }

// ---------- 执行（唯一的写入口） ----------
function execute(card) {
  const p = card.payload || {};
  switch (card.type) {
    case 'plot.create': {
      if (!p.name || !(+p.area > 0)) return { ok: false };
      const plot = store.plots.save({ name: p.name, area: +p.area, lat: '', lng: '', address: p.address || '' });
      return { ok: true, plotId: plot.id };
    }
    case 'plot.update': {
      const cur = store.plots.get(p.plotId); if (!cur) return { ok: false };
      store.plots.save({ id: cur.id, name: p.name || cur.name, area: +p.area > 0 ? +p.area : cur.area, lat: cur.lat, lng: cur.lng, address: cur.address || '' });
      return { ok: true };
    }
    case 'plot.remove': {
      if (!store.plots.get(p.plotId)) return { ok: false };
      store.plots.remove(p.plotId);
      return { ok: true };
    }
    case 'plot.locate': return { ok: false };
    case 'tag.cost': {
      const name = String(p.name || '').trim();
      if (!name) return { ok: false };
      store.tags.addCost(p.cat, name);
      return { ok: store.tags.cost(p.cat).indexOf(name) >= 0 };
    }
    case 'tag.log': {
      const name = String(p.name || '').trim();
      if (!name) return { ok: false };
      if (!store.tags.logTag(name)) store.tags.addLog({ name });
      return { ok: !!store.tags.logTag(name) };
    }
    case 'weather.set': {
      if (!store.plots.get(p.plotId) || !p.date) return { ok: false };
      store.weather.setManual(p.plotId, p.date, p.t, p.p, p.wind === '' ? undefined : p.wind);
      return { ok: true };
    }
    case 'season.create': {
      const plot = store.plots.get(p.plotId); if (!plot) return { ok: false };
      if (store.seasons.current(plot.id)) return { ok: false };
      if (p.crop !== 'wheat' && p.crop !== 'corn') return { ok: false };
      const s = store.seasons.save({ plotId: plot.id, crop: p.crop, variety: p.variety || '', sowDate: p.sowDate, seedRate: p.seedRate || '', tillage: '', status: 'growing' });
      weather.fillSeason(s).catch(() => null);
      advisor.onSeasonChanged(s.id);
      return { ok: true, seasonId: s.id };
    }
    case 'season.harvest': {
      const s = store.seasons.get(p.seasonId); if (!s || s.status === 'done') return { ok: false };
      store.seasons.save({ id: s.id, status: 'done', harvestDate: p.date, yieldJin: p.yieldJin || '', harvestNote: p.note || '' });
      advisor.onSeasonChanged(s.id);
      return { ok: true };
    }
    case 'season.remove': {
      if (!store.seasons.get(p.seasonId)) return { ok: false };
      store.seasons.remove(p.seasonId);
      return { ok: true };
    }
    case 'season.variety': {
      const s = store.seasons.get(p.seasonId); if (!s || !p.variety) return { ok: false };
      store.seasons.save({ id: s.id, variety: String(p.variety).slice(0, 20) });
      return { ok: true };
    }
    case 'log.remove': {
      if (!store.logs.get(p.logId)) return { ok: false };
      store.logs.remove(p.logId);
      return { ok: true };
    }
    case 'cost.remove': {
      if (!store.costs.get(p.costId)) return { ok: false };
      store.costs.remove(p.costId);
      return { ok: true };
    }
    case 'task.complete': {
      const t = store.tasks.complete(p.taskId, '', p.date || U.today());
      return { ok: !!t };
    }
    case 'task.create': {
      const s = store.seasons.get(p.seasonId); if (!s) return { ok: false };
      const id = p.key ? s.id + '#' + p.key : undefined;
      const t = store.tasks.save({ id, seasonId: s.id, plotId: s.plotId, key: p.key || '', source: p.source || 'user', title: p.title, dueStart: p.dueStart, dueEnd: p.dueEnd || p.dueStart, userDue: true,
        ops: p.ops || [], why: p.why && p.why.length ? p.why : [p.source === 'advice' ? '参谋建议' : '你说的'], steps: p.steps || [], ref: p.ref || '', matType: p.matType || '', target: p.target || '', level: 'week', status: 'open' });
      return { ok: true, taskId: t.id };
    }
    case 'task.update': { store.tasks.setDue(p.taskId, p.dueStart, p.dueEnd); return { ok: true }; }
    case 'task.dismiss': {
      const t = store.tasks.get(p.taskId); if (!t) return { ok: false };
      store.tasks.dismiss(p.taskId, p.reason);
      if (p.remember && t.key) store.memory.add({ text: plotName(store.seasons.get(t.seasonId) || {}) + '不用「' + t.title + '」', plotId: t.plotId, seasonId: t.seasonId, kind: 'suppress', ruleKey: t.key, source: '对话' });
      return { ok: true };
    }
    case 'log.create': {
      const ids = p.seasonIds || [];
      let first = null;
      ids.forEach(sid => {
        const s = store.seasons.get(sid); if (!s) return;
        const plot = store.plots.get(s.plotId) || {};
        const l = store.logs.save({ seasonId: sid, date: p.date, ops: p.ops, text: p.text, machine: p.machine,
          areaMu: ids.length > 1 ? (plot.area || '') : (p.areaMu || ''), materials: (p.materials || []).map(m => ({ type: m.type, name: m.name, rate: m.rate || '', unit: m.unit || '' })),
          growth: '', pest: '', moisture: '' });
        if (!first) first = l;
        advisor.onLogSaved(l, sid === (store.tasks.get(p.taskId) || {}).seasonId ? p.taskId : '');
      });
      return { ok: !!first, logId: first ? first.id : '' };
    }
    case 'cost.create': {
      const c = store.costs.save({ seasonId: p.allocations[0].seasonId, date: p.date, cat: p.cat, sub: p.sub, allocations: p.allocations, calc: p.calc || undefined, split: p.split || undefined, note: p.note || '' });
      return { ok: true, costId: c.id };
    }
    case 'stage.calibrate': {
      const s = store.seasons.get(p.seasonId); if (!s) return { ok: false };
      growth.calibrate(s, p.stage);
      store.memory.add({ text: plotName(s) + (s.variety ? s.variety : '') + '按实际校准为' + (growth.stagesOf(s).list.find(x => x.key === p.stage) || {}).name, plotId: s.plotId, seasonId: s.id, kind: 'note', source: '校准' });
      advisor.onSeasonChanged(s.id);
      return { ok: true };
    }
    case 'memory.add': { const m = store.memory.add({ text: p.text, plotId: p.plotId, seasonId: p.seasonId, source: '对话' }); return { ok: !!m }; }
    case 'memory.remove': { store.memory.remove(p.id); return { ok: true }; }
  }
  return { ok: false };
}

// 补槽位后改写卡片（用量）
function fillCard(card, fill) {
  if (!card || card.type !== 'log.create') return card;
  const mats = (card.payload.materials || []).slice();
  const i = mats.findIndex(m => !m.rate);
  if (i < 0) return card;
  mats[i] = Object.assign({}, mats[i], { rate: fill.rate, unit: fill.unit || mats[i].unit });
  const seasons = card.payload.seasonIds.map(id => store.seasons.get(id)).filter(Boolean);
  const nc = cardLog(seasons, Object.assign({}, card.payload, { materials: mats }), card.payload.taskId);
  nc.id = card.id;
  return nc;
}

// 输入框上方的常用说法（按上下文）
function chipsFor(ctx) {
  const rc = resolveCtx(ctx);
  if (rc.task) return ['已经干过了', '往后推几天', '这块地不用'];
  if (rc.season) return ['接下来该干啥', '这季花了多少', '上回打药哪天'];
  return ['提醒我…', '今天干了啥活', '你记住了啥'];
}

module.exports = { ask, askImage, execute, fillCard, chipsFor, resolveCtx, fromLLM, ACTIONS, AI_MODELS, AI_MODEL_KEY, modelChoice };
