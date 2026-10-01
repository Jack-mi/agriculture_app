// 跟参谋说 · 对话引擎
// 对象两类：任务（新建 / 调整 / 删除 / 完成）+ 地块（问建议→转任务、记事、记账、校准生育期、查询）+ 记住 / 忘掉
// 流程：理解（本地解析；配置了云开发 AI 时先走大模型，结果同样过白名单校验）→ 出确认卡片 → 农户确认 → execute 写数据
// AI 永远不直接改数据：所有写操作只发生在 execute(card)
const U = require('./util.js');
const C = require('./const.js');
const store = require('./store.js');
const growth = require('./growth.js');
const advisor = require('./advisor.js');
const nlu = require('./nlu.js');
const pesticide = require('./pesticide.js');
const { RULES } = require('./rules.js');
const kb = require('./kb.js');

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
function growingPlots() {
  return store.seasons.growing().map(s => ({ season: s, plot: store.plots.get(s.plotId) || { id: s.plotId, name: '' } }));
}
// 从话里找地块 → 在种季；找不到就用上下文；都没有且只有一块在种地 → 用它
function seasonsFromText(text, rc) {
  const g = growingPlots();
  const ids = nlu.matchPlots(text, g.map(x => x.plot));
  if (ids.length) return g.filter(x => ids.indexOf(x.plot.id) >= 0).map(x => x.season);
  if (rc.season) return [rc.season];
  if (g.length === 1) return [g[0].season];
  return [];
}
function plotName(season) { const p = store.plots.get(season.plotId) || {}; return p.name || ''; }
function seasonLabel(season) { return plotName(season) + ' · ' + C.cropOf(season.crop).name + (season.variety ? ' ' + season.variety : ''); }

let seq = 0;
function cid() { seq += 1; return 'card_' + Date.now().toString(36) + '_' + seq; }

// ---------- 卡片构造（全部走这里，LLM 结果也是） ----------
function cardTaskCreate(season, title, date, opts) {
  opts = opts || {};
  const d = date || U.addDays(U.today(), 1);
  const ops = nlu.matchOps(title);
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

// ---------- 意图：本地解析 ----------
const RE = {
  memList: /记住了?(我)?(些)?(啥|什么)|你都记|记得我?(啥|什么)/,
  memForget: /忘(掉|了吧|了)|别记|不用记/,
  memAdd: /^记住[:：，,\s]?(.+)/,
  qCost: /花了多少|多少钱|投了多少|成本多少|花费多少/,
  qLast: /上(回|次|一次).{0,6}(哪天|啥时候|什么时候|几号)/,
  qStage: /(什么|啥|哪个)阶段|到哪了|长到哪/,
  advice: /该干(啥|什么)|要干(啥|什么)|接下来|还要干|有啥建议|什么建议|要不要/,
  remind: /提醒我|记得叫我|别忘了|到时(候)?(叫|提醒)我|帮我记着(去)?/,
  dismiss: /不用(做|打|弄|干|浇|施)?了?|不需要|不做了|不打了|算了|不弄了|这件不用/,
  done: /(已经|都|早就?|昨天|前天|今天|刚)?.{0,6}(干|弄|做|打|浇|施|收|查|补|除)(完|过|好)(了)?|弄完了|干完了/,
  change: /改到|推到|换到|挪到|延到|最早|往后推|推几天|推一|提前|来不了|晚几天|改成/
};
// 句子里"最后出现的日期"（优先"改到/最早"之后）
function pickDate(text) {
  const m = text.match(/(改到|推到|换到|挪到|延到|最早|改成)(.*)/);
  if (m) { const d = nlu.parseDate(m[2]); if (d) return d; }
  const parts = text.split(/[，,。；;！!？?\s]/).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) { const d = nlu.parseDate(parts[i]); if (d) return d; }
  return '';
}

function understand(text, ctx) {
  const t = String(text || '').trim();
  const rc = resolveCtx(ctx);
  const out = { reply: '', cards: [], chips: [], pending: null };
  if (!t) return out;

  // ---- 记住 / 忘掉 ----
  if (RE.memList.test(t)) {
    const list = store.memory.all();
    out.reply = list.length ? '记着这 ' + list.length + ' 条：' : '还没记住什么。跟我说「记住：……」就行。';
    out.list = list.map(m => ({ id: m.id, text: m.text, src: m.source + ' · ' + advisor.md(U.fmtDate(new Date(m.createdAt))) }));
    out.chips = list.length ? ['忘掉第 1 条'] : [];
    return out;
  }
  const ma = t.match(RE.memAdd);
  if (ma) { out.reply = '好，记下这条：'; out.cards.push(cardMemAdd(ma[1].trim(), rc.season)); return out; }
  if (RE.memForget.test(t) && store.memory.all().length) {
    const list = store.memory.all();
    const idx = t.match(/第\s*(\d+|[一二三四五六七八九十]+)\s*条/);
    let hit = idx ? list[nlu.cn2num(idx[1]) - 1] : null;
    if (!hit) {
      let best = 0;
      list.forEach(m => { const s = overlap(t, m.text); if (s > best) { best = s; hit = m; } });
      if (best < 2) hit = null;
    }
    if (hit) { out.reply = '要忘掉这条吗？'; out.cards.push(cardMemRemove(hit)); return out; }
    out.reply = '没找到是哪一条，你说「你记住了啥」我列给你看。';
    return out;
  }

  // ---- 查询 ----
  const qs = seasonsFromText(t, rc);
  if (RE.qCost.test(t)) return answerCost(t, qs.length ? qs : store.seasons.growing(), out);
  if (RE.qLast.test(t)) return answerLast(t, qs.length ? qs : store.seasons.growing(), out);
  if (RE.qStage.test(t) && !RE.done.test(t)) return answerStage(qs.length ? qs : store.seasons.growing(), out);

  // ---- 问建议 ----
  if (RE.advice.test(t) && !RE.remind.test(t)) {
    if (!qs.length) { out.reply = '问的是哪块地？'; out.chips = growingPlots().map(x => x.plot.name + '接下来该干啥'); return out; }
    return adviseFor(qs[0], t, out);
  }

  // ---- 新建任务 ----
  if (RE.remind.test(t)) {
    const ss = qs;
    if (!ss.length) { out.reply = '是哪块地的事？'; out.chips = growingPlots().map(x => x.plot.name); out.pending = { kind: 'remind', text: t }; return out; }
    const d = pickDate(t) || U.addDays(U.today(), 1);
    const title = remindTitle(t);
    out.reply = '好的，' + advisor.md(d) + ' 提醒你' + (ss.length > 1 ? '' : '给' + plotName(ss[0])) + title + '。';
    ss.forEach(s => out.cards.push(cardTaskCreate(s, title, d)));
    return out;
  }

  // ---- 挂在任务上的调整 ----
  if (rc.task && rc.task.status === 'open') {
    if (RE.dismiss.test(t) && !RE.done.test(t)) {
      const reason = t.replace(RE.dismiss, '').replace(/[，,。]/g, ' ').trim();
      out.reply = '明白，这件先不做。';
      out.cards.push(cardTaskDismiss(rc.task, reason, /以后|每年|一直|都不/.test(t)));
      if (!/以后|每年|一直|都不/.test(t)) { out.chips = ['以后这块地都不用']; out.pending = { kind: 'dismissRemember', taskId: rc.task.id }; }
      return out;
    }
    const calib = calibFrom(t, rc.season);
    const isDone = RE.done.test(t);
    const shift = nlu.parseShift(t);
    const newDate = RE.change.test(t) ? (pickDate(t) || (isFinite(shift) ? U.addDays(rc.task.dueStart > U.today() ? rc.task.dueStart : U.today(), shift) : '')) : '';
    if (calib) out.cards.push(calib);
    if (isDone) {
      const draft = logDraft(t, [rc.season]);
      if (!draft.ops.length) draft.ops = (rc.task.ops || []).slice(0, 2);
      draft.date = nlu.parseDate(t) || U.today();
      out.cards.push(cardLog([rc.season], draft, rc.task.id));
      const money = nlu.parseMoney(t);
      if (money) out.cards.push(cardCost([rc.season], money, costDraft(draft, rc.task)));
    } else if (newDate) {
      const extra = [];
      if (/没(完全)?熟|还没熟|不熟/.test(t)) extra.push('地里还有没熟的，收完这批再看剩下的');
      out.cards.push(cardTaskUpdate(rc.task, newDate, extra));
      out.chips = ['记住这个情况', '就这一次'];
      out.pending = { kind: 'rememberAfterUpdate', text: t, seasonId: rc.season.id };
    }
    if (out.cards.length) {
      out.reply = out.cards.length > 1 ? '收到 ' + out.cards.length + ' 件事：' : (isDone ? '好，记一笔：' : newDate ? '明白，' + advisor.md(newDate) + '再做：' : '收到：');
      return out;
    }
  }

  // ---- 生育期校准（地块上下文或话里有地块） ----
  const calibSeason = qs[0] || rc.season;
  const calib = calibSeason ? calibFrom(t, calibSeason) : null;

  // ---- 记事 / 记账 ----
  const ops = nlu.matchOps(t);
  const money = nlu.parseMoney(t);
  if (calib) out.cards.push(calib);
  if (ops.length || money) {
    const ss = qs.length ? qs : [];
    if (!ss.length) {
      out.reply = '是哪块地？'; out.chips = growingPlots().map(x => x.plot.name).concat(growingPlots().length > 1 ? ['都是'] : []);
      out.pending = { kind: 'needPlot', text: t };
      return out;
    }
    const draft = logDraft(t, ss);
    // 顺带把对应的规则任务一起完成（同季、同类活、open）
    const tid = matchTaskForOps(ss[0], draft.ops);
    if (ops.length) out.cards.push(cardLog(ss, draft, ss.length === 1 ? tid : ''));
    if (money) out.cards.push(cardCost(ss, money, costDraft(draft)));
    const missRate = (draft.materials || []).find(m => m.type === '农药' && !m.rate);
    out.reply = out.cards.length > 1 ? '记 ' + out.cards.length + ' 样：' : '记一笔：';
    if (missRate) { out.ask = missRate.name + '每亩用了多少？不记得也可以先空着。'; out.pending = { kind: 'fillRate', cardId: out.cards[calib ? 1 : 0].id }; }
    return out;
  }
  if (calib) { out.reply = '收到：'; return out; }

  // ---- 没听懂：给两种理解让农户点选 ----
  out.reply = '我没太听明白，你是想：';
  out.chips = [rc.task ? '把这件改个日期' : '记一笔今天干的活', rc.season ? plotName(rc.season) + '接下来该干啥' : '新建一个提醒'];
  return out;
}

// 多轮：补槽位（地块 / 用量 / 记住）
function followUp(text, pending, ctx) {
  const t = String(text || '').trim();
  if (!pending) return null;
  if (pending.kind === 'needPlot' || pending.kind === 'remind') {
    const g = growingPlots();
    const ids = /都是|都|全部/.test(t) ? g.map(x => x.plot.id) : nlu.matchPlots(t, g.map(x => x.plot));
    if (!ids.length) return null;
    const names = g.filter(x => ids.indexOf(x.plot.id) >= 0).map(x => x.plot.name).join('、');
    return understand(pending.text + ' ' + names, ctx);
  }
  if (pending.kind === 'fillRate') {
    const um = t.match(/(\d+(?:\.\d+)?|[零一二两三四五六七八九十百半]+)\s*(克|g|毫升|ml|斤|公斤)/i);
    const v = um ? nlu.cn2num(um[1]) : nlu.firstNum(t.replace(/(一|每|1)亩/g, ''));
    if (!(v > 0)) return null;
    const unit = /克|g/i.test(t) ? 'g/亩' : /毫升|ml/i.test(t) ? 'ml/亩' : /公斤/.test(t) ? '公斤/亩' : /斤/.test(t) ? '斤/亩' : '';
    return { reply: '好，补上用量。', fill: { cardId: pending.cardId, rate: v, unit }, cards: [], chips: [] };
  }
  if (pending.kind === 'rememberAfterUpdate') {
    if (/记住|记着|要|对|是/.test(t) && !/不用|不要|就这一次/.test(t)) {
      const s = store.seasons.get(pending.seasonId);
      return { reply: '好，记下这条：', cards: [cardMemAdd(memText(pending.text, s), s)], chips: [] };
    }
    if (/就这一次|不用|不要/.test(t)) return { reply: '好，只改这一次。', cards: [], chips: [] };
    return null;
  }
  if (pending.kind === 'dismissRemember') {
    if (/以后|都不用|每年/.test(t)) {
      const task = store.tasks.get(pending.taskId);
      if (!task) return null;
      return { reply: '好，以后这块地不再推「' + task.title + '」。', cards: [cardTaskDismiss(task, '以后都不用', true)], chips: [] };
    }
    return null;
  }
  return null;
}

// ---------- 意图细节 ----------
function remindTitle(t) {
  let s = t.replace(RE.remind, '').replace(/(明天|后天|大后天|今天|下周[一二三四五六日天]?|\d{1,2}月\d{1,2}(日|号)?|\d{1,2}(号|日)|[一二三四五六七八九十]+月[一二三四五六七八九十]+(日|号)?)/g, '');
  const plots = store.plots.all().map(p => p.name).filter(Boolean);
  plots.forEach(n => { s = s.split(n).join(''); });
  s = s.replace(/^[去给把在到的,，\s]+/, '').replace(/[，,。！!？?\s]+$/, '').replace(/[，,]/g, '，');
  return s || '干活';
}
function memText(text, season) {
  const pn = season ? plotName(season) : '';
  const t = text.replace(/[，,。]+/g, '，').slice(0, 30);
  return (pn && t.indexOf(pn) < 0 ? pn + '：' : '') + t;
}
function overlap(a, b) {
  let n = 0;
  for (let i = 0; i < b.length - 1; i++) if (a.indexOf(b.slice(i, i + 2)) >= 0) n++;
  return n;
}
function calibFrom(t, season) {
  if (!season) return null;
  const key = growth.stageByName(season.crop, t);
  if (!key) return null;
  if (!/了|都|已经|到了|现在是|现在|进入/.test(t)) return null;
  const cur = growth.current(season);
  if (cur.stage.key === key) return null;
  return cardCalib(season, key);
}
function logDraft(t, seasons) {
  const ops = nlu.matchOps(t);
  const names = pesticide.REG.map(r => r.name).concat(pesticide.BLOCK.map(b => b.name));
  const materials = nlu.parseMaterials(t, names).map(m => Object.assign({ unit: m.type === '农药' ? (pesticide.REG.find(r => r.name === m.name) || {}).unit || 'ml/亩' : '斤/亩' }, m));
  if (/补种|补了/.test(t) && ops.indexOf('播种') < 0) ops.push('播种');
  const area = nlu.parseArea(t);
  return { ops, materials, machine: nlu.parseMachine(t), areaMu: area > 0 ? area : '', text: t, date: pickDate(t) || U.today() };
}
const OP_COST = { 打药: ['mach', '飞防'], 机械作业: ['mach', '其他'], 施肥: ['agri', '化肥'], 播种: ['mach', '播种'], 收获: ['mach', '收获'], 浇水: ['labor', '按天用工'], 除草: ['agri', '农药'] };
function costDraft(draft, task) {
  let cat = 'agri', sub = '其他';
  const ops = draft.ops.length ? draft.ops : (task ? task.ops : []);
  const hit = /无人机|飞防/.test(draft.text) ? ['mach', '飞防'] : (ops.map(o => OP_COST[o]).find(Boolean) || null);
  if (/雇|工钱|人工/.test(draft.text)) { cat = 'labor'; sub = '按天用工'; }
  else if (hit) { cat = hit[0]; sub = hit[1]; }
  if (store.tags.cost(cat).indexOf(sub) < 0) sub = store.tags.cost(cat)[0] || sub;
  return { cat, sub, date: draft.date, note: [draft.machine, (draft.materials || []).map(m => m.name).join('、')].filter(Boolean).join(' · ') };
}
function matchTaskForOps(season, ops) {
  if (!season || !ops.length) return '';
  const t = store.tasks.bySeason(season.id).find(x => x.status === 'open' && (x.ops || []).some(o => ops.indexOf(o) >= 0) && x.dueStart <= U.addDays(U.today(), 7));
  return t ? t.id : '';
}

// ---------- 查询 ----------
function answerCost(t, seasons, out) {
  const subWords = ['化肥', '农药', '种子', '飞防', '播种', '收获', '拉粮', '运输', '土地流转'];
  const sub = subWords.find(w => t.indexOf(w) >= 0);
  const catKey = /雇工|人工/.test(t) ? 'labor' : /机械/.test(t) ? 'mach' : /农资/.test(t) ? 'agri' : '';
  const lines = seasons.map(s => {
    let sum = 0;
    store.costs.bySeason(s.id).forEach(c => { if ((!sub || c.sub === sub) && (!catKey || c.cat === catKey)) sum += store.costs.amountFor(c, s.id); });
    return { name: seasonLabel(s), sum };
  });
  const total = lines.reduce((a, b) => a + b.sum, 0);
  out.reply = (sub || (catKey ? C.catOf(catKey).name : '这季')) + '一共花了 ¥' + U.money(total) + (lines.length > 1 ? '：' : '。');
  if (lines.length > 1) out.list = lines.map(l => ({ id: l.name, text: l.name, src: '¥' + U.money(l.sum) }));
  return out;
}
function answerLast(t, seasons, out) {
  const ops = nlu.matchOps(t);
  let best = null;
  seasons.forEach(s => store.logs.bySeason(s.id).forEach(l => {
    if (ops.length && !(l.ops || []).some(o => ops.indexOf(o) >= 0)) return;
    if (!best || l.date > best.l.date) best = { l, s };
  }));
  out.reply = best ? '上回' + (ops[0] || '记事') + '是 ' + advisor.md(best.l.date) + '，' + plotName(best.s) + (best.l.text ? '：「' + best.l.text.slice(0, 20) + '」' : '') + '。距今 ' + U.diffDays(best.l.date, U.today()) + ' 天。'
    : '没找到' + (ops[0] || '') + '的记录。';
  return out;
}
function answerStage(seasons, out) {
  out.reply = seasons.length ? seasons.map(s => { const c = growth.current(s, advisor.forecastOf(s.plotId)); return plotName(s) + '：' + c.stage.name + (c.next && c.eta ? '，约 ' + advisor.md(c.eta) + ' 到' + c.next.name : ''); }).join('；') + '。'
    : '现在没有在种的地块。';
  out.chips = ['阶段不对，我说一下'];
  return out;
}

// ---------- 问建议：把后面阶段会用到的规则提前拿出来，作为"建议"，不自动进待办 ----------
function adviseFor(season, t, out) {
  const fc = advisor.forecastOf(season.plotId);
  const cur = growth.current(season, fc);
  const logs = store.logs.bySeason(season.id);
  const plot = store.plots.get(season.plotId) || {};
  const existing = store.tasks.bySeason(season.id).filter(x => x.status === 'open').map(x => x.key);
  const seen = {};
  const cards = [];
  const focus = /追肥|施肥|上肥/.test(t) ? ['施肥'] : /打药|病|虫/.test(t) ? ['打药'] : /浇/.test(t) ? ['浇水'] : null;
  // 当前 + 后两个阶段各模拟一次
  for (let k = 0; k <= 2 && cur.idx + k < cur.list.length; k++) {
    const stage = cur.list[cur.idx + k];
    const next = cur.list[cur.idx + k + 1] || null;
    const eta = k === 0 ? U.today() : (k === 1 ? cur.eta : '') || U.addDays(U.today(), 20 * k);
    const st = Object.assign({}, cur, { stage, next, eta: next ? '' : '', gdd: stage.gdd });
    const ctx = { season, plot, st, fc: k === 0 ? fc : [], alerts: [], logs, U, lastLogOf(ops) { return logs.find(l => !ops || (l.ops || []).some(o => ops.indexOf(o) >= 0)) || null; } };
    RULES.forEach(r => {
      if ((r.crop !== '*' && r.crop !== season.crop) || r.source !== 'stage' || seen[r.key] || existing.indexOf(r.key) >= 0) return;
      const o = r.test(ctx);
      if (!o) return;
      if (focus && !(o.ops || []).some(x => focus.indexOf(x) >= 0)) return;
      seen[r.key] = true;
      const start = k === 0 ? o.due[0] : eta;
      cards.push(cardTaskCreate(season, o.title, start, { source: 'advice', dueEnd: U.addDays(start, U.diffDays(o.due[0], o.due[1])), why: o.why, steps: o.steps, ref: o.ref, matType: o.matType, target: o.target, key: 'advice.' + r.key,
        rows: [(o.why || [])[0] || '', o.ref ? '依据：' + (require('./kb.js').get(o.ref) || {}).title : ''].filter(Boolean) }));
    });
  }
  const open = store.tasks.bySeason(season.id).filter(x => x.status === 'open');
  const base = '现在' + cur.stage.name + (cur.next && cur.eta ? '，约 ' + advisor.md(cur.eta) + ' 到' + cur.next.name : '') + '。';
  if (!cards.length) {
    out.reply = base + (open.length ? '眼下的事都已经在待办里了：' + open.map(x => x.title).slice(0, 3).join('、') + '。' : (focus ? '这个阶段不用' + focus[0] + '。' : '这阵子没有要紧的活，记得常去巡田。'));
    return out;
  }
  out.reply = base + '接下来建议 ' + cards.length + ' 件，觉得在理就加成任务：';
  out.cards = cards.slice(0, 3);
  return out;
}

// ---------- 云开发 AI（可选）：输出同样的 actions，再经白名单转卡片 ----------
function fromLLM(json, ctx) {
  const rc = resolveCtx(ctx);
  const out = { reply: String(json.reply || '').slice(0, 200), cards: [], chips: [] };
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
      } else if (a.type === 'log.create' || a.type === 'cost.create') {
        // 记事 / 记账：金额和用量必须能被本地解析复核，LLM 不直接给数字落账
        const loc = understand(a.source || '', ctx);
        loc.cards.filter(c => c.type === a.type).forEach(c => out.cards.push(c));
      }
    } catch (e) { /* 丢弃不合法动作 */ }
  });
  return out;
}
function valid(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : ''; }

// 可选的参谋模型：本地规则兜底免费；云开发 AI 支持混元 / DeepSeek
const AI_MODELS = [
  { key: 'local', label: '本地规则（免费）', provider: '', name: '' },
  { key: 'hunyuan', label: '混元 Turbo', provider: 'hunyuan-exp', name: 'hunyuan-turbos-latest' },
  { key: 'dsv3', label: 'DeepSeek V3', provider: 'deepseek', name: 'deepseek-v3' },
  { key: 'dsr1', label: 'DeepSeek R1', provider: 'deepseek', name: 'deepseek-r1' },
  { key: 'byok', label: 'DeepSeek（自己的 Key）', provider: 'byok', name: 'deepseek-chat' }
];
const AI_MODEL_KEY = 'guyuji_ai_model';
// 当前选用的模型：用户在「我的」里切换（存 Storage），缺省回落到 app.globalData.aiModel，再回落本地规则
function modelChoice() {
  try {
    const k = wx.getStorageSync(AI_MODEL_KEY);
    const m = AI_MODELS.find(x => x.key === k);
    if (m) return m;
  } catch (e) {}
  const app = typeof getApp === 'function' ? getApp() : null;
  const g = app && app.globalData && app.globalData.aiModel;
  if (g && g.name) return { key: 'custom', label: g.name, provider: g.provider, name: g.name };
  return AI_MODELS[0];
}

// ask：优先 LLM（已选云模型且可用），否则 / 失败时本地解析；history 为最近几轮对话
function ask(text, ctx, pending, history) {
  const f = followUp(text, pending, ctx);
  if (f) return Promise.resolve(f);
  const model = modelChoice();
  if (model.provider === 'byok') return askByok(text, ctx, null, history);
  const ai = typeof wx !== 'undefined' && wx.cloud && wx.cloud.extend && wx.cloud.extend.AI;
  if (!model.provider || !ai) return Promise.resolve(understand(text, ctx));
  return callLLM(ai, model, text, ctx, history).then(j => {
    const r = j ? fromLLM(j, ctx) : null;
    return r && (r.cards.length || r.reply) ? r : understand(text, ctx);
  }).catch(() => understand(text, ctx));
}
// ---------- 系统提示（云开发 AI 与 BYOK 云函数共用） ----------
// 设计：先是个能聊农业的参谋，再是个能记账的助手。问答正常答，记东西才出 actions。
function sysPrompt() {
  const kbText = Object.keys(kb.DOCS).map(k => '· 《' + kb.DOCS[k].title + '》(' + kb.DOCS[k].org + ')：' + kb.DOCS[k].excerpt).join('\n');
  const regText = pesticide.REG.map(r => r.name + '(' + r.form + '，' + r.crops.map(c => C.cropOf(c).name).join('/') + '，防' + r.target + '，' + r.rate[0] + '–' + r.rate[1] + ' ' + r.unit + ')').join('；');
  const stageText = ['wheat', 'corn'].map(c =>
    C.cropOf(c).name + '：' + growth.STAGES[c].map(s => s.name).join('→')
  ).join('\n');
  return '你是「田祖记」的农事参谋，服务对象是胶东种粮大户（小麦、夏玉米为主）。你既是有经验的庄稼把式，也是懂合规的农技员。\n' +
    '【怎么聊】\n' +
    '- 农户问农业问题就正常回答，可以把道理讲清楚，别只回一句话。说人话、口语化，农户怎么种地你怎么说。\n' +
    '- 拿不准就直说拿不准，别编数据、别编药名。涉及农药只推荐已登记药剂，剂量按登记用量讲，并提醒看标签。\n' +
    '- 只有农户明确想记活、记账、设提醒、改任务时，才在 actions 里出动作；问答和闲聊一律不出动作。\n' +
    '【输出格式】只输出 JSON：{"reply":"回复（可多说几句，需要分段用\\n）","actions":[可为空数组]}\n' +
    'actions 只能是：task.create{seasonId,title,date}、task.update{taskId,date}、task.dismiss{taskId,reason,remember}、stage.calibrate{seasonId,stage}、memory.add{text}、memory.remove{id}、log.create{source}、cost.create{source}（source 填农户原话）。日期一律 YYYY-MM-DD，seasonId 只能用上下文里给的。\n' +
    '【生育期顺序】\n' + stageText + '\n' +
    '【本地技术依据】\n' + kbText + '\n' +
    '【农药登记（参考）】' + regText + '。限用：' + pesticide.BLOCK.map(b => b.name + '（' + b.reason + '）').join('；') + '。';
}

// 组装消息：系统提示 + 最近几轮对话 + 本轮（可带图）
function buildMessages(text, ctx, imageBase64, history) {
  const rc = resolveCtx(ctx);
  const context = {
    today: U.today(),
    task: rc.task ? { id: rc.task.id, title: rc.task.title, due: rc.task.dueStart } : null,
    seasons: store.seasons.growing().map(s => ({ id: s.id, plot: plotName(s), crop: C.cropOf(s.crop).name, variety: s.variety || '', stage: growth.current(s).stage.name })),
    memory: store.memory.all().map(m => ({ id: m.id, text: m.text }))
  };
  let userContent = '当前上下文：' + JSON.stringify(context) + '\n农户说：' + text;
  // 带图：OpenAI 视觉格式（仅 DeepSeek Flash 等支持图片的模型；调用方保证模型支持）
  if (imageBase64) {
    userContent = [
      { type: 'text', text: userContent },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + imageBase64 } }
    ];
  }
  const msgs = [{ role: 'system', content: sysPrompt() }];
  (history || []).slice(-12).forEach(h => {
    if (h && h.content && (h.role === 'user' || h.role === 'assistant')) msgs.push({ role: h.role, content: String(h.content).slice(0, 600) });
  });
  msgs.push({ role: 'user', content: userContent });
  return msgs;
}
function callLLM(ai, model, text, ctx, history) {
  const messages = buildMessages(text, ctx, null, history);
  return ai.createModel(model.provider || 'hunyuan-exp').generateText({
    model: model.name || 'hunyuan-turbos-latest',
    messages
  }).then(r => {
    const s = (r && (r.text || (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content))) || '';
    const m = s.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    return s ? { reply: s, actions: [] } : null; // 模型直接回了纯文本也接住
  });
}
// BYOK：走 advisorChat 云函数（Key 存云端，不下发）；失败回落本地规则；imageBase64 带图（DeepSeek Flash 支持）
function askByok(text, ctx, imageBase64, history) {
  const cf = typeof wx !== 'undefined' && wx.cloud && wx.cloud.callFunction;
  if (!cf) return Promise.resolve(understand(text, ctx));
  return wx.cloud.callFunction({ name: 'advisorChat', data: { action: 'chat', messages: buildMessages(text, ctx, imageBase64, history) } }).then(r => {
    const res = r && r.result;
    if (!res || !res.ok || !res.text) return understand(text, ctx);
    const m = String(res.text).match(/\{[\s\S]*\}/);
    let j = null;
    if (m) { try { j = JSON.parse(m[0]); } catch (e) { j = null; } }
    if (!j) {
      // JSON 里夹了真实换行等情况：单独抠 reply 字段；抠不出来就当纯文本整段用
      const rm = String(res.text).match(/"reply"\s*:\s*"([\s\S]*?)"\s*[,}]/);
      j = rm ? { reply: rm[1].replace(/\\n/g, '\n'), actions: [] } : { reply: String(res.text), actions: [] };
    }
    const out = j ? fromLLM(j, ctx) : null;
    return out && (out.cards.length || out.reply) ? out : understand(text, ctx);
  }).catch(() => understand(text, ctx));
}

// 带图提问：仅 BYOK（DeepSeek Flash 支持图片）；其他模型退回文字描述引导
function askImage(text, imageBase64, ctx) {
  const model = modelChoice();
  if (model.provider !== 'byok') {
    return Promise.resolve({ reply: '照片收到了。看图识物要用「DeepSeek（自己的 Key）」模型，去 我的 → 参谋 AI 模型 切换后重发。', cards: [], chips: [] });
  }
  return askByok(text || '看看这张照片，地里是什么情况？', ctx, imageBase64);
}

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

module.exports = { understand, followUp, ask, askImage, execute, fillCard, chipsFor, resolveCtx, fromLLM, ACTIONS, AI_MODELS, AI_MODEL_KEY, modelChoice, buildMessages, sysPrompt };
