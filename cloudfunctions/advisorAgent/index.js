// 农事参谋 · 多智能体运行时（生产环境）
// Agent loop：模型提议 → schema 校验 → 执行 → 观察 → 继续，封顶 8 轮。
// 写操作只有"起草"：draft_* 工具产出动作草稿，农户在 App 里点确认才落库，模型永远没有直接写权限。
// 设计见 docs/advisor-agents.md。Key 读 config 集合：先查 per-user 文档 advisor_ai_<openid>，
// 没有再兜底历史全局 advisor_ai（控制台手工维护）；Key 不下发客户端。按用户限流。
const cloud = require('wx-server-sdk');
const https = require('https');
const { DOCS, PESTICIDES, BLOCKED, STAGES } = require('./kb');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COST_CATS = ['agri', 'mach', 'trans', 'labor', 'asset'];
const MATERIAL_TYPES = ['种子', '农药', '化肥', '其他'];
const COST_CAT_NAMES = { agri: '农资投入', mach: '机械作业', trans: '运输成本', labor: '雇工成本', asset: '固定资产' };
const INCOME_CATS = { grain: '卖粮', subsidy: '补贴', rent: '土地租金', service: '农机服务', insure: '保险赔付', inother: '其他' };
const REC_FREQS = ['week', 'month', 'quarter', 'year'];

// 用户的 tags 单文档（库存/周期账/账户/模板/收入类型都挂这里）
async function tagsDoc(openid) {
  const r = await db.collection('tags').where({ _openid: openid }).limit(1).get().catch(() => ({ data: [] }));
  return (r.data && r.data[0]) || {};
}
const dirOf = c => (c && c.dir === 'in' ? 'in' : 'out');
const catName = c => (dirOf(c) === 'in' ? (INCOME_CATS[c.cat] || c.cat || '其他') : (COST_CAT_NAMES[c.cat] || c.cat || '其他'));

function cfgDoc(openid) {
  return db.collection('config').doc('advisor_ai_' + openid).get()
    .then(r => (r.data && r.data.apiKey) ? r.data : db.collection('config').doc('advisor_ai').get().then(x => x.data))
    .catch(() => db.collection('config').doc('advisor_ai').get().then(x => x.data).catch(() => null));
}

const RL_CAP = 30; // 每用户每天 agent 调用上限（每次最多 20 次模型调用，费用大头）
// ponytail: 计数非原子，并发下会少计；防滥用够用
async function rateLimit(openid, action, cap) {
  const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const id = 'rl_' + action + '_' + openid + '_' + day;
  try {
    const col = db.collection('config');
    const r = await col.doc(id).get().catch(() => null);
    const n = (r && r.data && r.data.n) || 0;
    if (n >= cap) return false;
    await col.doc(id).set({ data: { n: n + 1, updatedAt: Date.now() } });
    return true;
  } catch (e) { return true; }
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
  if (name === 'query_plots') {
    const [plots, seasons] = await Promise.all([
      db.collection('plots').where({ _openid: openid }).limit(50).get(),
      db.collection('seasons').where({ _openid: openid, status: 'growing' }).limit(50).get()
    ]);
    const growing = {};
    seasons.data.forEach(s => { growing[s.plotId] = s._id; });
    return plots.data.map(p => ({
      plotId: p._id, name: p.name, area: p.area, address: p.address || '',
      located: p.lat !== undefined && p.lat !== '' && p.lat !== null,
      growingSeasonId: growing[p._id] || ''
    }));
  }
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
    return r.data.map(l => ({ id: l.id || l._id, seasonId: l.seasonId, date: l.date, ops: l.ops || [], text: l.text || '', growth: l.growth || '', pest: l.pest || '', machine: l.machine || '', areaMu: l.areaMu || '', materials: l.materials || [], moisture: l.moisture || '' }));
  }
  if (name === 'query_costs') {
    const r = await db.collection('costs').where({ _openid: openid }).orderBy('date', 'desc').limit(100).get();
    let rows = r.data.filter(c => !c.deletedAt);
    // dir 过滤：in 只查收入 / out 只查支出（收支双态后不分会算错账）
    if (a.dir === 'in' || a.dir === 'out') rows = rows.filter(c => dirOf(c) === a.dir);
    return rows.map(c => ({
      id: c.id || c._id, dir: dirOf(c), catName: catName(c), sub: c.sub || '',
      seasonAllocations: normAlloc(c), date: c.date,
      total: normAlloc(c).reduce((s, x) => s + x.amount, 0),
      account: c.account || '', note: c.note || '',
      debt: c.debt ? { party: c.debt.party || '', dueDate: c.debt.dueDate || '', paidAmount: +c.debt.paidAmount || 0, settled: !!c.debt.settled } : null
    }));
  }
  if (name === 'query_tasks') {
    const where = { _openid: openid };
    if (a.status) where.status = a.status;
    const r = await db.collection('tasks').where(where).orderBy('dueStart', 'asc').limit(50).get();
    return r.data.map(t => ({ taskId: t._id, seasonId: t.seasonId, title: t.title, dueStart: t.dueStart, dueEnd: t.dueEnd, status: t.status, why: t.why || [] }));
  }
  // 收支总览：净收益 + 支出/收入结构 + 应收应付。问"赚了/花了多少、谁欠钱"先调这个，别自己拿流水加
  if (name === 'query_summary') {
    const [costsR, seasonsR] = await Promise.all([
      db.collection('costs').where({ _openid: openid }).limit(1000).get(),
      db.collection('seasons').where({ _openid: openid }).limit(50).get()
    ]);
    const sid = a.seasonId || '';
    let income = 0, expense = 0, recv = 0, pay = 0;
    const outByCat = {}, inByCat = {};
    costsR.data.filter(c => !c.deletedAt).forEach(c => {
      const all = normAlloc(c).filter(x => !sid || x.seasonId === sid);
      const amt = all.reduce((s, x) => s + x.amount, 0);
      if (!amt) return;
      const d = dirOf(c), cn = catName(c);
      if (d === 'in') { income += amt; inByCat[cn] = (inByCat[cn] || 0) + amt; } else { expense += amt; outByCat[cn] = (outByCat[cn] || 0) + amt; }
      if (c.debt && !c.debt.settled) {
        const remain = amt - (+c.debt.paidAmount || 0);
        if (remain > 0) { if (d === 'in') recv += remain; else pay += remain; }
      }
    });
    const r2 = n => Math.round(n * 100) / 100;
    const season = sid ? seasonsR.data.find(s => s._id === sid) : null;
    return {
      scope: season ? (season.crop + '季') : '全部', income: r2(income), expense: r2(expense), net: r2(income - expense),
      expenseByCat: Object.keys(outByCat).map(k => ({ cat: k, total: r2(outByCat[k]) })).sort((x, y) => y.total - x.total),
      incomeByCat: Object.keys(inByCat).map(k => ({ cat: k, total: r2(inByCat[k]) })).sort((x, y) => y.total - x.total),
      receivable: r2(recv), payable: r2(pay)
    };
  }
  // 资金账户：余额 = 期初 + 实收 − 实付（挂赊的只算已销账部分）
  if (name === 'query_accounts') {
    const [tags, costsR] = await Promise.all([
      tagsDoc(openid),
      db.collection('costs').where({ _openid: openid }).limit(1000).get()
    ]);
    const rows = (Array.isArray(tags.accounts) ? tags.accounts : []).map(x => ({ key: x.key, name: x.name, init: +x.init || 0, income: 0, expense: 0 }));
    const byKey = {}; rows.forEach(r => { byKey[r.key] = r; });
    costsR.data.filter(c => !c.deletedAt).forEach(c => {
      const r = byKey[c.account || ''];
      if (!r) return;
      const total = normAlloc(c).reduce((s, x) => s + x.amount, 0);
      const amt = c.debt ? (+c.debt.paidAmount || 0) : total;
      if (dirOf(c) === 'in') r.income += amt; else r.expense += amt;
    });
    const r2 = n => Math.round(n * 100) / 100;
    return rows.map(r => ({ name: r.name, balance: r2(r.init + r.income - r.expense), income: r2(r.income), expense: r2(r.expense) }));
  }
  // 欠款台账：应收（别人欠我，dir=in）/ 应付（我欠别人，dir=out），只看没结清的
  if (name === 'query_debts') {
    const r = await db.collection('costs').where({ _openid: openid }).orderBy('date', 'desc').limit(200).get();
    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    return r.data.filter(c => !c.deletedAt && c.debt && !c.debt.settled && (!a.dir || dirOf(c) === a.dir)).map(c => {
      const total = normAlloc(c).reduce((s, x) => s + x.amount, 0);
      const remain = Math.round((total - (+c.debt.paidAmount || 0)) * 100) / 100;
      return {
        id: c.id || c._id, dir: dirOf(c), catName: catName(c), sub: c.sub || '', party: c.debt.party || '未填对方',
        total, remain, dueDate: c.debt.dueDate || '', overdue: !!(c.debt.dueDate && c.debt.dueDate < today), date: c.date
      };
    }).filter(x => x.remain > 0);
  }
  if (name === 'query_recurring') {
    const tags = await tagsDoc(openid);
    return (Array.isArray(tags.recurring) ? tags.recurring : []).map(r => ({
      id: r.id, name: r.name, dir: r.dir === 'in' ? 'in' : 'out', catName: r.dir === 'in' ? (INCOME_CATS[r.cat] || r.cat) : (COST_CAT_NAMES[r.cat] || r.cat),
      sub: r.sub || '', amount: +r.amount || 0, freq: r.freq, day: r.day, month: r.month || '',
      startAt: r.startAt || '', endAt: r.endAt || '', enabled: r.enabled !== false
    }));
  }
  if (name === 'query_templates') {
    const tags = await tagsDoc(openid);
    return (Array.isArray(tags.templates) ? tags.templates : []).map(t => ({
      name: t.name, dir: t.dir === 'in' ? 'in' : 'out', catName: t.dir === 'in' ? (INCOME_CATS[t.cat] || t.cat) : (COST_CAT_NAMES[t.cat] || t.cat),
      sub: t.sub || '', amount: +t.amount || 0, unitPrice: +t.unitPrice || 0, mode: t.mode || 'fixed', note: t.note || ''
    }));
  }
  if (name === 'query_stock') {
    const tags = await tagsDoc(openid);
    const r2 = n => Math.round(n * 100) / 100;
    return (Array.isArray(tags.stock) ? tags.stock : []).map(x => ({
      name: x.name, unit: x.unit || '件', onHand: +x.onHand || 0,
      warnAt: +x.warnAt || 0, low: (+x.warnAt || 0) > 0 && (+x.onHand || 0) < +x.warnAt,
      lastPrice: +x.lastPrice || 0, value: r2((+x.onHand || 0) * (+x.lastPrice || 0))
    }));
  }
  // 预算进度：在种季的预算 vs 已花（预算挂 season 记录上：total 总预算 / perMu 每亩目标）
  if (name === 'query_budget') {
    const [seasonsR, plotsR, costsR] = await Promise.all([
      db.collection('seasons').where({ _openid: openid, status: 'growing' }).limit(50).get(),
      db.collection('plots').where({ _openid: openid }).limit(50).get(),
      db.collection('costs').where({ _openid: openid }).limit(1000).get()
    ]);
    const pmap = {}; plotsR.data.forEach(p => { pmap[p._id] = p; });
    const r2 = n => Math.round(n * 100) / 100;
    return seasonsR.data.map(s => {
      const spent = costsR.data.filter(c => !c.deletedAt && dirOf(c) === 'out')
        .reduce((sum, c) => sum + normAlloc(c).filter(x => x.seasonId === s._id).reduce((z, x) => z + x.amount, 0), 0);
      const b = s.budget || {};
      const area = +((pmap[s.plotId] || {}).area) || 0;
      const eff = +b.total > 0 ? +b.total : (+b.perMu > 0 && area > 0 ? b.perMu * area : 0);
      return {
        seasonId: s._id, crop: s.crop, plot: (pmap[s.plotId] || {}).name || '',
        budget: r2(eff), spent: r2(spent), pct: eff > 0 ? Math.round(spent / eff * 100) : 0, hasBudget: eff > 0
      };
    });
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
    const dir = a.dir === 'in' ? 'in' : 'out';
    if (!ids.length || !okDate(a.date)) return { error: '缺 seasonIds/date' };
    if (dir === 'in' && !INCOME_CATS[a.cat]) return { error: '收入的 cat 只能是 ' + Object.keys(INCOME_CATS).join('/') };
    if (dir === 'out' && COST_CATS.indexOf(a.cat) < 0) return { error: '支出的 cat 只能是 ' + COST_CATS.join('/') };
    const MODES = ['fixed', 'perMu', 'perDay', 'perJin', 'perMuPrice'];
    const mode = MODES.indexOf(a.mode) >= 0 ? a.mode : 'fixed';
    if (mode === 'fixed' && !(+a.amount > 0)) return { error: '缺 amount' };
    drafts.push({
      type: 'cost.create',
      cost: {
        seasonIds: ids, dir, cat: a.cat, sub: String(a.sub || (dir === 'in' ? INCOME_CATS[a.cat] : '其他')).slice(0, 12), date: a.date,
        money: {
          mode, amount: +a.amount || 0,
          unitPrice: +a.unitPrice > 0 ? +a.unitPrice : 0, mu: +a.mu > 0 ? +a.mu : 0,
          people: +a.people > 0 ? +a.people : 0, qty: +a.qty > 0 ? +a.qty : 0
        },
        account: String(a.account || '').slice(0, 12),
        debt: a.debt && a.debt.party ? { party: String(a.debt.party).slice(0, 20), dueDate: okDate(a.debt.dueDate) || '' } : null,
        note: String(a.note || '').slice(0, 60)
      }
    });
    return { drafted: true };
  }
  // 销账：把某笔挂赊的账收款/付款（可部分）。先 query_debts 拿 id
  if (name === 'draft_debt_settle') {
    if (!a.costId) return { error: '缺 costId，先 query_debts' };
    drafts.push({ type: 'debt.settle', costId: String(a.costId), amount: +a.amount > 0 ? +a.amount : 0, date: okDate(a.date) || '' });
    return { drafted: true };
  }
  // 周期账：每周/每月/每季/每年固定要记的账（到期只提醒，不自动扣）
  if (name === 'draft_recurring') {
    const dir = a.dir === 'in' ? 'in' : 'out';
    if (!a.name || !(+a.amount > 0)) return { error: '缺 name/amount' };
    if (REC_FREQS.indexOf(a.freq) < 0) return { error: 'freq 只能是 week/month/quarter/year' };
    if (dir === 'in' && !INCOME_CATS[a.cat]) return { error: '收入的 cat 只能是 ' + Object.keys(INCOME_CATS).join('/') };
    if (dir === 'out' && COST_CATS.indexOf(a.cat) < 0) return { error: '支出的 cat 只能是 ' + COST_CATS.join('/') };
    drafts.push({
      type: 'recurring.create',
      recurring: {
        name: String(a.name).slice(0, 20), dir, cat: a.cat, sub: String(a.sub || '').slice(0, 12),
        amount: +a.amount, freq: a.freq, day: +a.day > 0 ? +a.day : 1, month: +a.month > 0 ? +a.month : 0
      }
    });
    return { drafted: true };
  }
  // 库存出入库：qty 正数入库、负数出库（如"尿素用了半袋"= -0.5）
  if (name === 'draft_stock_adjust') {
    if (!a.name || !(+a.qty)) return { error: '缺 name/qty' };
    drafts.push({ type: 'stock.adjust', name: String(a.name).slice(0, 20), unit: String(a.unit || '').slice(0, 6), qty: +a.qty, price: +a.price > 0 ? +a.price : 0 });
    return { drafted: true };
  }
  if (name === 'draft_income_tag') {
    const nm = String(a.name || '').trim().slice(0, 12);
    if (!nm) return { error: '缺 name' };
    drafts.push({ type: 'tag.income', name: nm });
    return { drafted: true };
  }
  // 编辑已有日志（改文字/操作/农资用量）。先 query_logs 拿 id
  if (name === 'draft_log_update') {
    if (!a.logId) return { error: '缺 logId，先 query_logs' };
    drafts.push({
      type: 'log.update', logId: String(a.logId),
      text: a.text === undefined ? '' : String(a.text).slice(0, 200),
      ops: Array.isArray(a.ops) ? a.ops.slice(0, 6) : null,
      materials: Array.isArray(a.materials) ? a.materials : null
    });
    return { drafted: true };
  }
  // 改种植季基础信息：播种时间 / 播种量 / 整地情况
  if (name === 'draft_season_update') {
    if (!a.seasonId) return { error: '缺 seasonId，先 query_seasons' };
    if (a.sowDate && !okDate(a.sowDate)) return { error: 'sowDate 格式 YYYY-MM-DD' };
    drafts.push({
      type: 'season.update', seasonId: String(a.seasonId),
      sowDate: okDate(a.sowDate) || '', seedRate: +a.seedRate > 0 ? +a.seedRate : 0,
      tillage: String(a.tillage || '').slice(0, 40)
    });
    return { drafted: true };
  }
  if (name === 'memory_save') {
    if (!a.text) return { error: '缺 text' };
    drafts.push({ type: 'memory.add', text: String(a.text).slice(0, 40) });
    return { drafted: true };
  }
  if (name === 'memory_forget') {
    if (!a.id) return { error: '缺 id，先 memory_search' };
    drafts.push({ type: 'memory.remove', id: String(a.id) });
    return { drafted: true };
  }
  if (name === 'draft_plot') {
    const plotName = String(a.name || '').trim().slice(0, 20);
    if (!plotName || !(+a.area > 0)) return { error: '缺 name 和 area（亩）' };
    drafts.push({ type: 'plot.create', name: plotName, area: +a.area, address: String(a.address || '').slice(0, 40) });
    return { drafted: true };
  }
  if (name === 'draft_plot_update') {
    if (!a.plotId || (!a.name && !(+a.area > 0))) return { error: '缺 plotId，以及要改的 name 或 area' };
    drafts.push({ type: 'plot.update', plotId: a.plotId, name: String(a.name || '').trim().slice(0, 20), area: +a.area > 0 ? +a.area : '' });
    return { drafted: true };
  }
  if (name === 'draft_plot_remove') {
    if (!a.plotId) return { error: '缺 plotId' };
    drafts.push({ type: 'plot.remove', plotId: a.plotId });
    return { drafted: true };
  }
  if (name === 'draft_season') {
    if (!a.plotId || (a.crop !== 'wheat' && a.crop !== 'corn') || !okDate(a.sowDate)) return { error: '缺 plotId / crop(wheat|corn) / sowDate' };
    const growing = await db.collection('seasons').where({ _openid: openid, plotId: a.plotId, status: 'growing' }).limit(1).get();
    if (growing.data.length) return { error: '这块地还有一季没收，先登记收获再开新季' };
    drafts.push({ type: 'season.create', plotId: a.plotId, crop: a.crop, sowDate: a.sowDate, variety: String(a.variety || '').slice(0, 20), seedRate: +a.seedRate > 0 ? +a.seedRate : '' });
    return { drafted: true };
  }
  if (name === 'draft_harvest') {
    if (!a.seasonId || !okDate(a.date)) return { error: '缺 seasonId/date' };
    drafts.push({ type: 'season.harvest', seasonId: a.seasonId, date: a.date, yieldJin: +a.yieldJin > 0 ? +a.yieldJin : '', note: String(a.note || '').slice(0, 80) });
    return { drafted: true };
  }
  if (name === 'draft_season_remove') {
    if (!a.seasonId) return { error: '缺 seasonId' };
    drafts.push({ type: 'season.remove', seasonId: a.seasonId });
    return { drafted: true };
  }
  if (name === 'draft_task_move') {
    if (!a.taskId || !okDate(a.date)) return { error: '缺 taskId/date' };
    drafts.push({ type: 'task.update', taskId: a.taskId, date: a.date });
    return { drafted: true };
  }
  if (name === 'draft_task_skip') {
    if (!a.taskId) return { error: '缺 taskId' };
    drafts.push({ type: 'task.dismiss', taskId: a.taskId, reason: String(a.reason || '').slice(0, 30), remember: !!a.remember });
    return { drafted: true };
  }
  if (name === 'draft_task_done') {
    if (!a.taskId) return { error: '缺 taskId' };
    drafts.push({ type: 'task.complete', taskId: a.taskId, date: okDate(a.date) ? a.date : '' });
    return { drafted: true };
  }
  if (name === 'draft_variety') {
    if (!a.seasonId || !String(a.variety || '').trim()) return { error: '缺 seasonId/variety' };
    drafts.push({ type: 'season.variety', seasonId: a.seasonId, variety: String(a.variety).trim().slice(0, 20) });
    return { drafted: true };
  }
  if (name === 'draft_log_remove') {
    if (!a.logId) return { error: '缺 logId，先 query_logs' };
    drafts.push({ type: 'log.remove', logId: String(a.logId) });
    return { drafted: true };
  }
  if (name === 'draft_cost_remove') {
    if (!a.costId) return { error: '缺 costId，先 query_costs' };
    drafts.push({ type: 'cost.remove', costId: String(a.costId) });
    return { drafted: true };
  }
  if (name === 'draft_stage') {
    if (!a.seasonId || !a.stage) return { error: '缺 seasonId/stage' };
    drafts.push({ type: 'stage.calibrate', seasonId: a.seasonId, stage: String(a.stage).slice(0, 20) });
    return { drafted: true };
  }
  if (name === 'draft_locate') {
    if (!a.plotId) return { error: '缺 plotId' };
    drafts.push({ type: 'plot.locate', plotId: a.plotId });
    return { drafted: true };
  }
  if (name === 'draft_cost_tag') {
    if (COST_CATS.indexOf(a.cat) < 0 || !String(a.name || '').trim()) return { error: '缺 cat/name，cat 只能是 ' + COST_CATS.join('/') };
    drafts.push({ type: 'tag.cost', cat: a.cat, name: String(a.name).trim().slice(0, 12) });
    return { drafted: true };
  }
  if (name === 'draft_log_tag') {
    if (!String(a.name || '').trim()) return { error: '缺 name' };
    drafts.push({ type: 'tag.log', name: String(a.name).trim().slice(0, 12) });
    return { drafted: true };
  }
  if (name === 'draft_weather') {
    if (!a.plotId || !okDate(a.date) || a.t === undefined || a.t === '' || a.p === undefined || a.p === '') return { error: '缺 plotId/date/t/p' };
    drafts.push({ type: 'weather.set', plotId: a.plotId, date: a.date, t: +a.t, p: +a.p, wind: a.wind === undefined || a.wind === '' ? '' : +a.wind });
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
  T('query_plots', '查农户的地块（名称、亩数、有没有在种的季、有没有定位）。新建地、开季、问"我有几块地"之前先调', {}),
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
  T('memory_save', '起草一条参谋要记住的偏好/情况（如"河边地不用 2,4-D"）', { text: { type: 'string' } }, ['text']),
  T('memory_forget', '起草忘掉一条已记住的偏好。先 memory_search 拿 id', { id: { type: 'string' } }, ['id']),
  T('draft_plot', '起草新建地块（农户确认后才落库）。农户说"帮我新建一块地"时用。定位先空着，之后在地块页补', { name: { type: 'string' }, area: { type: 'number', description: '亩' }, address: { type: 'string' } }, ['name', 'area']),
  T('draft_plot_update', '起草修改地块名称或亩数（确认后才改）', { plotId: { type: 'string' }, name: { type: 'string' }, area: { type: 'number' } }, ['plotId']),
  T('draft_plot_remove', '起草删除地块。会连带删掉该地下的季、账、记事，确认卡上必须说清不能恢复', { plotId: { type: 'string' } }, ['plotId']),
  T('draft_season', '起草开一个种植季（确认后才落库）。crop 只能 wheat 或 corn。这块地已有在种季时不要调，先收获', {
    plotId: { type: 'string' }, crop: { type: 'string', description: 'wheat 或 corn' }, sowDate: { type: 'string' },
    variety: { type: 'string' }, seedRate: { type: 'number', description: '斤/亩，可省略' }
  }, ['plotId', 'crop', 'sowDate']),
  T('draft_harvest', '起草登记收获、结束这一季（确认后才落库）', { seasonId: { type: 'string' }, date: { type: 'string' }, yieldJin: { type: 'number', description: '总产量斤，可省略' }, note: { type: 'string' } }, ['seasonId', 'date']),
  T('draft_season_remove', '起草删除一整季（账、记事、任务一起删，不能恢复）', { seasonId: { type: 'string' } }, ['seasonId']),
  T('draft_task_move', '起草把某条待办改到新日期（确认后才改）', { taskId: { type: 'string' }, date: { type: 'string' } }, ['taskId', 'date']),
  T('draft_task_skip', '起草"这条不做了"。remember=true 表示以后这块地不再推同类任务', { taskId: { type: 'string' }, reason: { type: 'string' }, remember: { type: 'boolean' } }, ['taskId']),
  T('draft_task_done', '起草把待办标成已完成（没有要记的农事明细时用；有明细用 draft_log 并带 taskId）', { taskId: { type: 'string' }, date: { type: 'string' } }, ['taskId']),
  T('draft_stage', '起草生育期校准。农户说地里实际已经到某阶段时用。stage 用中文，如出苗期、三叶期、分蘖期、返青期、拔节期、抽穗期、灌浆期、成熟期、大喇叭口期、抽雄期、吐丝期', { seasonId: { type: 'string' }, stage: { type: 'string' } }, ['seasonId', 'stage']),
  T('draft_variety', '起草修改某一季的品种（确认后才改）', { seasonId: { type: 'string' }, variety: { type: 'string' } }, ['seasonId', 'variety']),
  T('draft_log_remove', '起草删除一条已有农事日志。先 query_logs 拿 id，确认卡上说明不能恢复', { logId: { type: 'string' } }, ['logId']),
  T('draft_cost_remove', '起草删除一笔已有账。先 query_costs 拿 id，确认卡上说明不能恢复', { costId: { type: 'string' } }, ['costId']),
  T('draft_locate', '起草给某块地选位置。确认后手机会打开地图，农户点一下才保存经纬度。云函数自己拿不到定位', { plotId: { type: 'string' } }, ['plotId']),
  T('draft_cost_tag', '起草一个新的记账细分类型（确认后才加入类型列表）', { cat: { type: 'string', description: 'agri/mach/trans/labor/asset' }, name: { type: 'string' } }, ['cat', 'name']),
  T('draft_log_tag', '起草一个新的记事类型（确认后才加入）', { name: { type: 'string' } }, ['name']),
  T('draft_weather', '起草手工改正某一天的天气（气温℃、降雨 mm，风速 m/s 可省略）。确认后才覆盖这一天', { plotId: { type: 'string' }, date: { type: 'string' }, t: { type: 'number' }, p: { type: 'number' }, wind: { type: 'number' } }, ['plotId', 'date', 't', 'p'])
  ,
  T('query_summary', '收支总览：净收益、支出/收入分类结构、应收应付合计。问"赚了/花了多少、收支构成、谁欠钱"先调这个，不要自己拿流水加', { seasonId: { type: 'string', description: '可选，限定某个种植季' } }),
  T('query_accounts', '查资金账户余额（现金/微信/支付宝/银行卡，余额=期初+实收−实付）', {}),
  T('query_debts', '查欠款台账（没结清的应收/应付：对方、金额、已还、还剩、约定日期、是否逾期）', { dir: { type: 'string', description: 'in 应收 / out 应付，默认全部' } }),
  T('query_recurring', '查周期账（每周/每月/每季/每年固定要记的账）', {}),
  T('query_templates', '查常用账模板（农户收藏的快速记账组合）', {}),
  T('query_stock', '查农资/粮食库存（在库量、预警、估值）', {}),
  T('query_budget', '查在种季预算进度（预算 vs 已花、百分比）', {}),
  T('draft_debt_settle', '起草销账：把某笔挂赊的账收款/付款（amount 省略 = 全部结清，可部分）。先 query_debts 拿 costId', { costId: { type: 'string' }, amount: { type: 'number' }, date: { type: 'string' } }, ['costId']),
  T('draft_recurring', '起草一个周期账（确认后才加入）。freq: week 每周 / month 每月 / quarter 每季 / year 每年；day: 周=周几(0-6) 月/季/年=几号；month: 季/年落在哪个月', {
    name: { type: 'string' }, dir: { type: 'string' }, cat: { type: 'string' }, sub: { type: 'string' },
    amount: { type: 'number' }, freq: { type: 'string' }, day: { type: 'number' }, month: { type: 'number' }
  }, ['name', 'cat', 'amount', 'freq']),
  T('draft_stock_adjust', '起草库存出入库（确认后才改）。qty 正数入库、负数出库，如"尿素用了半袋" = qty -0.5 unit 袋', { name: { type: 'string' }, unit: { type: 'string' }, qty: { type: 'number' }, price: { type: 'number' } }, ['name', 'qty']),
  T('draft_income_tag', '起草一个新的收入类型（确认后才加入）', { name: { type: 'string' } }, ['name']),
  T('draft_log_update', '起草编辑一条已有农事日志（改文字/操作/农资用量，确认后才改）。先 query_logs 拿 logId', { logId: { type: 'string' }, text: { type: 'string' }, ops: { type: 'array', items: { type: 'string' } }, materials: { type: 'array', items: { type: 'object' } } }, ['logId']),
  T('draft_season_update', '起草修改种植季基础信息（播种时间 sowDate / 播种量 seedRate 斤每亩 / 整地情况 tillage，确认后才改）', { seasonId: { type: 'string' }, sowDate: { type: 'string' }, seedRate: { type: 'number' }, tillage: { type: 'string' } }, ['seasonId'])
];

function pickTools(names) {
  const set = {};
  names.forEach(n => { set[n] = true; });
  return TOOLS.filter(t => set[t.function.name]);
}
const BOOK_TOOLS = pickTools(['query_costs', 'query_summary', 'query_accounts', 'query_debts', 'query_recurring', 'query_templates', 'query_stock', 'query_budget', 'query_plots', 'query_seasons', 'draft_cost', 'draft_cost_remove', 'draft_cost_tag', 'draft_income_tag', 'draft_debt_settle', 'draft_recurring', 'draft_stock_adjust', 'memory_search', 'memory_save']);
const LOG_TOOLS = pickTools(['query_logs', 'query_plots', 'query_seasons', 'query_tasks', 'draft_log', 'draft_log_update', 'draft_log_remove', 'draft_log_tag', 'draft_task', 'draft_task_move', 'draft_task_skip', 'draft_task_done']);
const AGRI_TOOLS = pickTools(['kb_search', 'pesticide_check', 'query_plots', 'query_seasons', 'query_weather', 'weather_forecast', 'draft_stage', 'draft_season', 'draft_season_update', 'draft_harvest', 'draft_variety', 'draft_season_remove', 'draft_plot', 'draft_plot_update', 'draft_plot_remove', 'draft_locate', 'draft_weather', 'memory_search', 'memory_save', 'memory_forget']);
const ORCH_TOOLS = [
  T('ask_bookkeeper', '交给记账子代理。花了多少、记一笔钱、删一笔账、新增记账细分类型', { request: { type: 'string', description: '用农户的原话说明要查或要记的账' } }, ['request']),
  T('ask_logger', '交给记事子代理。记一笔农活、删记事、新增记事类型、设提醒、改日期、这条不做了、标完成', { request: { type: 'string' } }, ['request']),
  T('ask_agronomist', '交给农事决策子代理。能不能打药浇水、生育期、技术依据、开季收获改品种、地块、地图选点、改正某一天天气', { request: { type: 'string' } }, ['request'])
];

function todayOf(context) {
  return (context && context.today) || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}
function orchPrompt(context) {
  const c = context || {};
  const plots = (c.plots || []).map(p => (p.name || '') + (p.area ? p.area + '亩' : '')).filter(Boolean).join('、');
  return '你是「田祖记」的农事参谋总管。你不自己查账、不自己记活、不自己下农事结论。\n' +
    '【今天】' + todayOf(c) + '\n' +
    '【地块】' + (plots || '还没有') + '\n' +
    '记账、花了多少、赚了多少、收入、欠款和销账、账户余额、库存、周期账、预算、记账类型 → ask_bookkeeper。记农活、删改记事、提醒和待办 → ask_logger。能不能打药、技术依据、生育期、开季收获、改播种时间播量整地、地块、选位置、改某一天天气 → ask_agronomist。\n' +
    '闲聊可以直接答。要干活或要查农户自己的数据，必须先叫对应子代理，再用它的结论用口语回复。需要强调用 **加粗**。不要输出 JSON。';
}
function expertPrompt(role, context) {
  const today = todayOf(context);
  const stageLine = ['wheat', 'corn'].map(c => (c === 'wheat' ? '小麦' : '玉米') + '：' + STAGES[c].map(s => s.name).join('→')).join('\n');
  const common = '【今天】' + today + '。农户说今天/昨天/明天按这个日子换算。查数据必须先调工具，禁止编。要改数据只能 draft_* 起草，确认后才落库。删除要说明不能恢复。回复给总管：一两句结论，加上你起草了什么。\n【上下文】' + JSON.stringify(context || {}) + '\n';
  if (role === 'bookkeeper') return '你是记账子代理。处理钱：收支记账（支出五类 agri/mach/trans/labor/asset，收入六类 grain/subsidy/rent/service/insure/inother）、欠款和销账、账户余额、库存、周期账、预算、记账类型。\n' +
    '问"赚/亏、花了多少、收支构成"先 query_summary；问欠款先 query_debts；记收入用 draft_cost dir=in；挂赊账在 draft_cost 里带 debt.party；销账用 draft_debt_settle。\n' + common;
  if (role === 'logger') return '你是记事子代理。只处理农事日志（含编辑已有日志）、记事类型和待办提醒。\n' + common;
  return '你是农事决策子代理。处理种植、植保、天气、地块和生育期。农药先 kb_search / pesticide_check，只推登记药剂。地图选点用 draft_locate，你拿不到经纬度。改正某一天天气用 draft_weather。\n【生育期】\n' + stageLine + '\n' + common;
}

function prepMessages(messages) {
  return messages.map(m => {
    if (!m || m.role !== 'assistant' || !m.tool_calls) return m;
    if (m.reasoning_content && String(m.reasoning_content).trim()) return m;
    return Object.assign({}, m, { reasoning_content: ' ' });
  });
}
function takeReason(msg, reasons) {
  const t = String((msg && (msg.reasoning_content || msg.reasoning)) || '').trim();
  if (t) reasons.push(t);
}
async function callDS(cfg, messages, tools) {
  const base = (cfg.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const body = {
    model: cfg.model || 'deepseek-flash',
    messages: prepMessages(messages),
    tools: tools,
    tool_choice: 'auto',
    stream: false,
    thinking: { type: 'enabled' },
    reasoning_effort: 'high'
  };
  const r = await postJSON(base + '/chat/completions', { authorization: 'Bearer ' + cfg.apiKey }, JSON.stringify(body));
  if (r.status !== 200) throw new Error('upstream ' + r.status + ': ' + (r.body || '').slice(0, 300));
  return JSON.parse(r.body);
}

// 一次请求里，总管和子代理加起来最多 20 次模型调用。
// 原来写死 8 轮，是怕云函数 60 秒超时；这个 20 是调用次数上限，不是业务上只能问 20 句。
// 云函数墙钟仍大约 60 秒，轮次多、模型慢时，可能在用满 20 次之前就被平台掐掉。
const MODEL_BUDGET = 20;
const EXPERTS = {
  ask_bookkeeper: { label: '记账', tools: BOOK_TOOLS, role: 'bookkeeper' },
  ask_logger: { label: '记事', tools: LOG_TOOLS, role: 'logger' },
  ask_agronomist: { label: '农事决策', tools: AGRI_TOOLS, role: 'agronomist' }
};

async function runExpert(cfg, spec, request, context, openid, drafts, budget, reasons, toolTrace) {
  const messages = [
    { role: 'system', content: expertPrompt(spec.role, context) },
    { role: 'user', content: String(request || '').slice(0, 800) }
  ];
  let last = '';
  for (let i = 0; i < MODEL_BUDGET && budget.n > 0; i++) {
    budget.n -= 1;
    const r = await callDS(cfg, messages, spec.tools);
    const msg = r.choices && r.choices[0] && r.choices[0].message;
    if (!msg) return { error: 'empty' };
    takeReason(msg, reasons);
    const calls = msg.tool_calls || [];
    if (!calls.length) return { answer: String(msg.content || last || '没有更多结论') };
    messages.push(msg);
    last = String(msg.content || last);
    for (const tc of calls) {
      const fn = tc.function || {};
      toolTrace.push(spec.label + ':' + (fn.name || ''));
      let args = {};
      try { args = JSON.parse(fn.arguments || '{}'); } catch (e) { args = {}; }
      let res;
      try { res = await impl(openid, fn.name, args, drafts); }
      catch (e) { res = { error: String(e.message || e).slice(0, 200) }; }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(res).slice(0, 4000) });
    }
  }
  return { answer: last || '这轮工具用完了，先按已经查到的说', drafted: true };
}

exports.main = async (event) => {
  const openid = (cloud.getWXContext() || {}).OPENID || '';
  if (!openid) return { ok: false, reason: 'noauth' };
  if (!(await rateLimit(openid, 'agent', RL_CAP))) return { ok: false, reason: 'ratelimit' };
  const cfg = await cfgDoc(openid);
  if (!cfg || !cfg.apiKey) return { ok: false, reason: 'nokey' };

  const message = String(event.message || '').trim();
  if (!message && !event.image) return { ok: false, reason: 'badargs' };

  const messages = [{ role: 'system', content: orchPrompt(event.context || {}) }];
  (Array.isArray(event.history) ? event.history : []).slice(-12).forEach(h => {
    if (h && h.content && (h.role === 'user' || h.role === 'assistant')) messages.push({ role: h.role, content: String(h.content).slice(0, 800) });
  });
  const userContent = event.image
    ? [{ type: 'text', text: message || '看看这张照片，地里是什么情况？' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + event.image } }]
    : message;
  messages.push({ role: 'user', content: userContent });

  const drafts = [];
  const toolTrace = [];
  const reasons = [];
  const budget = { n: MODEL_BUDGET };
  try {
    for (let i = 0; i < MODEL_BUDGET && budget.n > 0; i++) {
      budget.n -= 1;
      const r = await callDS(cfg, messages, ORCH_TOOLS);
      const msg = r.choices && r.choices[0] && r.choices[0].message;
      if (!msg) return { ok: false, reason: 'empty' };
      takeReason(msg, reasons);
      const calls = msg.tool_calls || [];
      const reasoning = reasons.filter(Boolean).join('\n\n').slice(0, 4000);
      if (!calls.length) {
        return { ok: true, reply: String(msg.content || ''), reasoning, actions: drafts, toolTrace };
      }
      messages.push(msg);
      for (const tc of calls) {
        const fn = tc.function || {};
        toolTrace.push(fn.name || '');
        let args = {};
        try { args = JSON.parse(fn.arguments || '{}'); } catch (e) { args = {}; }
        const spec = EXPERTS[fn.name];
        let res;
        if (!spec) res = { error: '总管只能调用三个子代理' };
        else {
          try { res = await runExpert(cfg, spec, args.request, event.context || {}, openid, drafts, budget, reasons, toolTrace); }
          catch (e) { res = { error: String(e.message || e).slice(0, 200) }; }
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(res).slice(0, 4000) });
      }
    }
    const notes = [];
    messages.forEach(m => {
      if (m.role !== 'tool') return;
      try {
        const j = JSON.parse(m.content);
        if (j && j.answer) notes.push(String(j.answer));
      } catch (e) {}
    });
    const reply = notes.length ? notes.join('\n') : (drafts.length ? '给你准备好了，确认就记上。' : '想了好几圈没理清楚，换个说法再问一次？');
    return { ok: true, reply, reasoning: reasons.filter(Boolean).join('\n\n').slice(0, 4000), actions: drafts, toolTrace };
  } catch (e) {
    return { ok: false, reason: 'model', message: String(e.message || e).slice(0, 300), actions: drafts, toolTrace };
  }
};
