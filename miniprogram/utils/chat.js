// 跟参谋说 · 对话引擎（纯大模型，无本地规则）
// 链路：chat.ask → advisorAgent 云函数（DeepSeek tool-calling 多智能体）→ 动作草稿 → fromLLM 白名单转确认卡 → 农户确认 → execute 写数据
// AI 永远不直接改数据：所有写操作只发生在 execute(card)
const U = require('./util.js');
const C = require('./const.js');
const store = require('./store.js');
const growth = require('./growth.js');
const advisor = require('./advisor.js');
const pesticide = require('./pesticide.js');

const ACTIONS = ['task.create', 'task.update', 'task.dismiss', 'log.create', 'cost.create', 'stage.calibrate', 'memory.add', 'memory.remove'];

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

// ---------- 动作 → 确认卡（白名单校验 + 结构化草稿） ----------
function fromLLM(json, ctx) {
  const rc = resolveCtx(ctx);
  const out = { reply: String(json.reply || '').slice(0, 1500), cards: [], chips: [] };
  (json.actions || []).forEach(a => {
    if (!a || ACTIONS.indexOf(a.type) < 0) return;
    try {
      if (a.type === 'task.create') {
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
        const c = cardCalib(s, a.stage); if (c) out.cards.push(c);
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
      if (res.reason === 'nokey') return { reply: '参谋还没配模型 Key：我的 → 参谋 AI 模型 → 粘贴你的 DeepSeek API Key 就好。', cards: [], chips: [] };
      return { reply: '参谋脑子卡了一下（' + (res.reason || '网络') + '），再说一次？', cards: [], chips: [] };
    }
    const out = fromLLM({ reply: res.reply, actions: res.actions || [] }, ctx);
    if (!out.reply && !out.cards.length) out.reply = '嗯，我在。想问啥直接说。';
    return out;
  }).catch(() => ({ reply: '网络不太好，参谋没接上线，稍后再试。', cards: [], chips: [] }));
}
function ask(text, ctx, pending, history) { return askAgent(text, ctx, null, history); }
function askImage(text, imageBase64, ctx) { return askAgent(text || '', ctx, imageBase64, null); }

// ---------- 执行（唯一的写入口） ----------
function execute(card) {
  const p = card.payload || {};
  switch (card.type) {
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
