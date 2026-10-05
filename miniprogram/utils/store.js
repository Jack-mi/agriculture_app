// 谷雨记 · 本地数据仓库
// 离线优先：所有读写都先落本地 Storage（弱网/无网可用），再由 sync.js 在联网时备份云端。
//
// 数据结构
// db = {
//   ver, updatedAt,
//   plots:   [{ id, name, area, lat, lng, address, createdAt }],
//   seasons: [{ id, plotId, crop, variety(品种，选填), sowDate, seedRate, tillage, status:'growing'|'done', harvestDate, yieldJin, harvestNote, createdAt }],
//   costs:   [{ id, dir:'out'|'in'(缺省=out), seasonId(兼容), allocations:[{seasonId, amount}], date, cat, sub, amount(=分摊合计), people, unitPrice, note, logId,
//               debt:{ party, dueDate, dueTag, settled, settledAt, paidAmount }, attachments:[{name,localPath,fileID,size}], audit:[{at,action,from,to,src}], deletedAt, createdAt }],
//   logs:    [{ id, seasonId, date, ops:[], text, growth, pest, machine, areaMu, materials:[{type,name,rate,unit}], moisture, fertName/fertRate(旧字段兼容), createdAt }],
//   weather: { [plotId]: { [date]: { t, p, wind, src:'api'|'manual' } } },
//   tasks:   [{ id(=seasonId#ruleKey 或随机), seasonId, plotId, key, source:'stage'|'weather'|'record'|'user'|'advice', title, why[], steps[], ref, ops[], matType, target,
//              dueStart, dueEnd, userDue, status:'open'|'done'|'dismissed'|'expired', logId, doneAt, reason }]   // 农事参谋任务
//   memory:  [{ id, text, plotId, seasonId, kind:'note'|'suppress', ruleKey, source:'对话'|'校准' }]              // 参谋记住的
//   seasons[i].stageCalib: { stage, date, gddAt }                                                              // 生育期校准
//   tags:    { cost: { [catKey]: ['种子', ...] }, income: ['卖粮', ...], log: [{ name, color, costCat, costSub }], logStock: true,
//              templates: [{ id, name, cat, sub, dir, mode:'fixed'|'perMu'|'perDay'|'perJin'|'perMuPrice', unitPrice, amount, people, split:'current'|'area'|'even', note }],
//              stock: [{ id, name, unit, onHand, warnAt, lastPrice, updatedAt }],          // 农资/粮食库存
//              stockInit: true,                                                            // 是否已设过期初（未设时暂不自动扣减）
//              recurring: [{ id, name, cat, sub, dir, mode, unitPrice, amount, freq:'week'|'month'|'quarter'|'year', day, dueTag, startAt, endAt, installment, lastFiredAt, enabled }] }   // 用户自定义类型 + 常用账 + 库存 + 周期账
//   costs[i].deletedAt / logs[i].deletedAt：软删（进回收站），30 天后本机清理
//   costs[i].calc: { mode, unitPrice, mu, people } | undefined   // 金额怎么算出来的（仅展示/回填，落账以 allocations 为准）
//   costs[i].expr: '320+180+95' | undefined                     // 键盘连加表达式
// }
//
// 同步契约：每次变更（upsert/remove/天气/标签）都会把 {col, op, id} 追加进 outbox 队列
// （Storage key: guyuji_outbox，崩溃不丢），sync.js 消费该队列逐条同步到云端对应集合。
// 删除采用墓碑机制：本地物理清除 + outbox 里的 remove 条目广播到云端。
const U = require('./util.js');
const C = require('./const.js');
const KEY = 'guyuji_db_v1';
const OUTBOX_KEY = 'guyuji_outbox';

let cache = null;

function defaultTags() {
  const cost = {};
  C.COST_CATS.forEach(c => { cost[c.key] = c.subs.slice(); });
  return {
    cost, income: C.INCOME_CATS.map(c => c.name), log: C.DEFAULT_LOG_TAGS.map(t => Object.assign({}, t)),
    templates: [], stock: [], stockInit: false, recurring: [], logStock: true,
    accounts: C.DEFAULT_ACCOUNTS.map(a => Object.assign({}, a))
  };
}

// 回收站保留天数
const TRASH_DAYS = 30;

function empty() {
  return { ver: 1, updatedAt: 0, plots: [], seasons: [], costs: [], logs: [], tasks: [], memory: [], weather: {}, tags: defaultTags() };
}

// ---------- outbox（待同步队列） ----------
function outbox() {
  try { return wx.getStorageSync(OUTBOX_KEY) || []; } catch (e) { return []; }
}
// 同一条目的重复变更只保留最新一次（按 col+id 去重）
function notify(col, op, id) {
  const q = outbox().filter(e => !(e.col === col && e.id === id));
  q.push({ col, op, id, at: Date.now() });
  wx.setStorageSync(OUTBOX_KEY, q);
}
// 天气记录在云端的确定性 _id（幂等 upsert）
function weatherId(plotId, date) { return plotId + '@' + date; }

function db() {
  if (cache) return cache;
  try { cache = wx.getStorageSync(KEY) || empty(); } catch (e) { cache = empty(); }
  return migrate(cache);
}

// 结构补齐（本地读取 / 云端恢复 / replaceAll 都走这里）
function migrate(cache) {
  ['plots', 'seasons', 'costs', 'logs', 'tasks', 'memory'].forEach(k => { if (!Array.isArray(cache[k])) cache[k] = []; });
  if (!cache.weather) cache.weather = {};
  if (!cache.tags) cache.tags = defaultTags();
  if (!cache.tags.cost) cache.tags.cost = defaultTags().cost;
  if (!Array.isArray(cache.tags.log)) cache.tags.log = [];
  if (!Array.isArray(cache.tags.templates)) cache.tags.templates = [];
  if (!Array.isArray(cache.tags.accounts) || !cache.tags.accounts.length) cache.tags.accounts = C.DEFAULT_ACCOUNTS.map(a => Object.assign({}, a));
  // 默认记事类型补齐（老库新增「播种/收获/病虫害观察」等）
  C.DEFAULT_LOG_TAGS.forEach(t => {
    if (!cache.tags.log.some(x => x.name === t.name)) cache.tags.log.push(Object.assign({}, t));
  });
  // 老库记事类型补"填写项"：默认类型按名称补默认 fields，自定义类型为空（只填具体情况）
  cache.tags.log.forEach(t => {
    if (!Array.isArray(t.fields)) {
      const def = C.DEFAULT_LOG_TAGS.find(x => x.name === t.name);
      t.fields = def ? def.fields.slice() : [];
      t.matType = def ? def.matType : '';
    }
  });
  if (!Array.isArray(cache.tags.income)) cache.tags.income = C.INCOME_CATS.map(c => c.name);
  if (!Array.isArray(cache.tags.stock)) cache.tags.stock = [];
  if (!Array.isArray(cache.tags.recurring)) cache.tags.recurring = [];
  if (cache.tags.stockInit === undefined) cache.tags.stockInit = false;
  if (cache.tags.logStock === undefined) cache.tags.logStock = true;
  purgeExpired(cache);
  return cache;
}

// 回收站到期真删（保留 TRASH_DAYS 天）
// ponytail: 本机清理，不广播 remove 到云端；过期文档若被 pull 回来会在下一次 migrate 再被清掉，无副作用
function purgeExpired(cache) {
  const cut = Date.now() - TRASH_DAYS * 86400000;
  ['costs', 'logs'].forEach(k => { cache[k] = cache[k].filter(x => !x.deletedAt || x.deletedAt > cut); });
}

function save(opts) {
  const d = db();
  d.updatedAt = Date.now();
  wx.setStorageSync(KEY, d);
  if (!(opts && opts.silent)) {
    wx.setStorageSync('guyuji_dirty', 1);
    const app = getApp && getApp();
    app && app.onDataChanged && app.onDataChanged();
  }
}

function replaceAll(data) {
  cache = migrate(Object.assign(empty(), data || {}));
  wx.setStorageSync(KEY, cache);
}

// ---------- 通用 ----------
function upsert(list, item, prefix) {
  const d = db();
  item.updatedAt = Date.now();
  if (!item.id) {
    item.id = U.uid(prefix);
    item.createdAt = Date.now();
    d[list].push(item);
  } else {
    const i = d[list].findIndex(x => x.id === item.id);
    if (i >= 0) d[list][i] = Object.assign({}, d[list][i], item);
    else d[list].push(item);
  }
  save();
  notify(list, 'upsert', item.id);
  return item;
}
function remove(list, id) {
  const d = db();
  d[list] = d[list].filter(x => x.id !== id);
  save();
  notify(list, 'remove', id);
}
function get(list, id) { return db()[list].find(x => x.id === id); }

// ---------- 软删 / 回收站 / 留痕 ----------
// 删除一律先进回收站：记录保留并打 deletedAt，云端走 upsert（不是 remove），换设备也能恢复
function softRemove(list, id) {
  const d = db();
  const it = d[list].find(x => x.id === id);
  if (!it) return null;
  pushAudit(it, '删除', '', '');
  it.deletedAt = Date.now();
  it.updatedAt = it.deletedAt;
  save();
  notify(list, 'upsert', id);
  return it;
}
function restoreItem(list, id) {
  const it = get(list, id);
  if (!it) return null;
  delete it.deletedAt;
  pushAudit(it, '恢复', '', '');
  it.updatedAt = Date.now();
  save();
  notify(list, 'upsert', id);
  return it;
}
// 回收站里所有软删记录（跨 costs / logs），倒序
function trashRows() {
  const rows = [];
  [['costs', '账目'], ['logs', '记事']].forEach(kv => {
    db()[kv[0]].filter(x => x.deletedAt).forEach(x => {
      const daysLeft = Math.max(0, TRASH_DAYS - Math.floor((Date.now() - x.deletedAt) / 86400000));
      let title = kv[1];
      if (kv[0] === 'costs') title = C.catOf(x.cat).name + ' · ' + (x.sub || '') + ' ¥' + U.money(allocTotal(x));
      else title = '记事：' + ((x.ops || []).join('、') || x.text || '');
      rows.push({ col: kv[0], kind: kv[1], id: x.id, title, at: x.deletedAt, daysLeft, dateText: U.cnDate(x.date) });
    });
  });
  return rows.sort((a, b) => b.at - a.at);
}
let _auditSrc = 'local';
function setAuditSrc(src) { _auditSrc = src || 'local'; }
// 操作留痕：只记关键动作，最多 50 条
function pushAudit(obj, action, from, to) {
  if (!Array.isArray(obj.audit)) obj.audit = [];
  obj.audit.push({ at: Date.now(), action, from: from === undefined ? '' : from, to: to === undefined ? '' : to, src: _auditSrc });
  if (obj.audit.length > 50) obj.audit = obj.audit.slice(-50);
  return obj.audit;
}

// 一笔账的分摊合计（= 整笔金额）
function allocTotal(c) { return Math.round(allocOf(c).reduce((a, x) => a + x.amount, 0) * 100) / 100; }

// ---------- 成本分摊归一化 ----------
// 旧记录 {seasonId, amount} 视为 [{seasonId, amount}]；amount 恒等于分摊合计
function allocOf(c) {
  if (Array.isArray(c.allocations) && c.allocations.length) {
    return c.allocations.filter(a => a && a.seasonId && (+a.amount || 0) > 0)
      .map(a => ({ seasonId: a.seasonId, amount: +a.amount }));
  }
  if (c.seasonId && (+c.amount || 0) > 0) return [{ seasonId: c.seasonId, amount: +c.amount }];
  return [];
}
// 按权重分摊 total（元，两位小数）：按"分"计算，最后一项吸收尾差，保证 Σ = total
function splitBy(total, weights) {
  const cents = Math.round((+total || 0) * 100);
  const n = weights.length;
  if (!n) return [];
  const w = weights.map(x => (+x > 0 ? +x : 0));
  const sum = w.reduce((a, b) => a + b, 0);
  const ws = sum > 0 ? w : w.map(() => 1);
  const tot = sum > 0 ? sum : n;
  let used = 0;
  return ws.map((x, i) => {
    if (i === n - 1) return (cents - used) / 100;
    const c = Math.floor(cents * x / tot);
    used += c;
    return c / 100;
  });
}

// 删除某些季后收敛成本：只移除对应分摊；仍分摊给其他季的保留并回写，否则整笔删除
function dropAllocations(d, sidSet) {
  const removed = [], updated = [];
  d.costs = d.costs.filter(c => {
    const all = allocOf(c);
    if (!all.some(a => sidSet.indexOf(a.seasonId) >= 0)) return true;
    const rest = all.filter(a => sidSet.indexOf(a.seasonId) < 0);
    if (rest.length) {
      c.allocations = rest;
      c.amount = rest.reduce((s, a) => s + a.amount, 0);
      c.seasonId = rest[0].seasonId;
      c.updatedAt = Date.now();
      updated.push(c.id);
      return true;
    }
    removed.push(c.id);
    return false;
  });
  return { removed, updated };
}

// ---------- 地块 ----------
const plots = {
  all() { return db().plots.slice().sort((a, b) => a.createdAt - b.createdAt); },
  get(id) { return get('plots', id); },
  save(p) { return upsert('plots', p, 'plot'); },
  remove(id) {
    const d = db();
    const sids = d.seasons.filter(s => s.plotId === id).map(s => s.id);
    const lids = d.logs.filter(l => sids.indexOf(l.seasonId) >= 0).map(l => l.id);
    const wdates = Object.keys(d.weather[id] || {});
    const tids = d.tasks.filter(t => sids.indexOf(t.seasonId) >= 0).map(t => t.id);
    d.tasks = d.tasks.filter(t => sids.indexOf(t.seasonId) < 0);
    d.seasons = d.seasons.filter(s => s.plotId !== id);
    const cids = dropAllocations(d, sids);
    d.logs = d.logs.filter(l => sids.indexOf(l.seasonId) < 0);
    delete d.weather[id];
    d.plots = d.plots.filter(p => p.id !== id);
    save();
    cids.removed.forEach(x => notify('costs', 'remove', x));
    cids.updated.forEach(x => notify('costs', 'upsert', x));
    lids.forEach(x => notify('logs', 'remove', x));
    tids.forEach(x => notify('tasks', 'remove', x));
    sids.forEach(x => notify('seasons', 'remove', x));
    wdates.forEach(dt => notify('weather', 'remove', weatherId(id, dt)));
    notify('plots', 'remove', id);
  }
};

// ---------- 种植季 ----------
const seasons = {
  all() { return db().seasons.slice().sort((a, b) => (b.sowDate > a.sowDate ? 1 : -1)); },
  growing() { return seasons.all().filter(s => s.status === 'growing'); },
  byPlot(plotId) { return seasons.all().filter(s => s.plotId === plotId); },
  current(plotId) { return seasons.byPlot(plotId).find(s => s.status === 'growing'); },
  get(id) { return get('seasons', id); },
  save(s) { if (!s.status) s.status = 'growing'; return upsert('seasons', s, 'season'); },
  remove(id) {
    const d = db();
    const cids = dropAllocations(d, [id]);
    const lids = d.logs.filter(l => l.seasonId === id).map(l => l.id);
    const tids = d.tasks.filter(t => t.seasonId === id).map(t => t.id);
    d.seasons = d.seasons.filter(s => s.id !== id);
    d.logs = d.logs.filter(l => l.seasonId !== id);
    d.tasks = d.tasks.filter(t => t.seasonId !== id);
    save();
    tids.forEach(x => notify('tasks', 'remove', x));
    cids.removed.forEach(x => notify('costs', 'remove', x));
    cids.updated.forEach(x => notify('costs', 'upsert', x));
    lids.forEach(x => notify('logs', 'remove', x));
    notify('seasons', 'remove', id);
  },
  // 品种快捷选项：本人历史用过的（按播种日倒序）在前，内置常见品种在后
  varieties(crop) {
    const used = [];
    seasons.all().forEach(s => { const v = (s.variety || '').trim(); if (s.crop === crop && v && used.indexOf(v) < 0) used.push(v); });
    const preset = (C.VARIETIES[crop] || []).filter(v => used.indexOf(v) < 0);
    return { used, preset, all: used.concat(preset) };
  },
  // 周期结束日：已收获取收获日，否则取今天
  endDate(s) { return s.status === 'done' && s.harvestDate ? s.harvestDate : U.today(); },
  // 本季预算：total 总预算（元）、perMu 每亩目标成本（元/亩）、cats 分类预算
  // 全为 0/空 = 没设预算；不新增云端集合，直接挂在 season 记录上
  budget(id) {
    const s = get('seasons', id);
    return (s && s.budget) || { total: 0, perMu: 0, cats: {} };
  },
  setBudget(id, b) {
    const s = get('seasons', id);
    if (!s) return null;
    s.budget = {
      total: Math.max(0, +((b && b.total) || 0)),
      perMu: Math.max(0, +((b && b.perMu) || 0)),
      cats: (b && b.cats) || {}
    };
    return upsert('seasons', s, 'season');
  }
};

// ---------- 记账 ----------
// 方向：'out' 支出 / 'in' 收入；旧数据没有 dir，一律当支出（零迁移）
function dirOf(c) { return c && c.dir === 'in' ? 'in' : 'out'; }
function isIncome(c) { return dirOf(c) === 'in'; }
// 未结清、且挂欠款的账
function isDebtOpen(c) { return !!(c.debt && c.debt.settled !== true); }

const costs = {
  dirOf,
  isIncome,
  allocTotal,
  bySeason(sid) {
    return db().costs.filter(c => !c.deletedAt && allocOf(c).some(a => a.seasonId === sid))
      .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : (b.date > a.date ? 1 : -1)));
  },
  // 全部（不含回收站）流水，倒序
  all(filter) {
    return db().costs.filter(c => !c.deletedAt).filter(c => !filter || filter(c))
      .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : (b.date > a.date ? 1 : -1)));
  },
  income(filter) { return costs.all(c => isIncome(c) && (!filter || filter(c))); },
  expense(filter) { return costs.all(c => !isIncome(c) && (!filter || filter(c))); },
  get(id) { return get('costs', id); },
  allocOf,
  splitBy,
  // 按地块面积比例分摊到多个种植季
  allocByArea(total, seasonIds) {
    const areas = seasonIds.map(id => { const s = get('seasons', id); const p = s && get('plots', s.plotId); return p ? +p.area || 0 : 0; });
    return splitBy(total, areas).map((amount, i) => ({ seasonId: seasonIds[i], amount }));
  },
  allocEven(total, seasonIds) {
    return splitBy(total, seasonIds.map(() => 1)).map((amount, i) => ({ seasonId: seasonIds[i], amount }));
  },
  // 这些种植季对应地块的面积合计（按亩计默认亩数）
  areaOf(seasonIds) {
    return Math.round(seasonIds.reduce((a, id) => { const s = get('seasons', id); const p = s && get('plots', s.plotId); return a + (p ? +p.area || 0 : 0); }, 0) * 10) / 10;
  },
  // 某笔账分摊到某季的金额（旧数据按整笔计入其 seasonId）
  amountFor(c, sid) {
    const a = allocOf(c).find(x => x.seasonId === sid);
    return a ? a.amount : 0;
  },
  // 欠款（应收 = 收入未结，应付 = 支出未结）
  debts(dir) {
    return db().costs.filter(c => !c.deletedAt && c.debt && dirOf(c) === dir)
      .sort((a, b) => {
        const as = a.debt.settled === true ? 1 : 0, bs = b.debt.settled === true ? 1 : 0;
        if (as !== bs) return as - bs;
        return a.date > b.date ? -1 : 1;
      });
  },
  debtTotal(dir) { return Math.round(costs.debts(dir).filter(isDebtOpen).reduce((s, c) => s + allocTotal(c) - (+c.debt.paidAmount || 0), 0) * 100) / 100; },
  // 销账：支持部分收款/付款（paidAmount 累加，够了才置 settled）
  settle(id, patch) {
    const c = get('costs', id);
    if (!c) return null;
    const amount = allocTotal(c);
    const paid = patch && patch.amount !== undefined ? (+patch.amount || 0) : amount;
    const prev = c.debt && +c.debt.paidAmount ? +c.debt.paidAmount : 0;
    const totalPaid = Math.round((prev + paid) * 100) / 100;
    c.debt = Object.assign({}, c.debt, {
      paidAmount: totalPaid,
      settled: totalPaid >= amount - 0.005,
      settledAt: (patch && patch.date) || U.today(),
      method: (patch && patch.method) || (c.debt && c.debt.method) || ''
    });
    pushAudit(c, '销账', U.money(prev), U.money(totalPaid));
    return upsert('costs', c, 'cost');
  },
  // 附件：先本机后云端（上传成功后回填 fileID）
  addAttachment(id, att) {
    const c = get('costs', id);
    if (!c) return null;
    c.attachments = (c.attachments || []).concat([att]);
    pushAudit(c, '加附件', '', att && att.name);
    return upsert('costs', c, 'cost');
  },
  removeAttachment(id, index) {
    const c = get('costs', id);
    if (!c || !Array.isArray(c.attachments)) return null;
    const gone = c.attachments[index];
    c.attachments = c.attachments.filter((_, i) => i !== index);
    pushAudit(c, '删附件', (gone && gone.name) || '', '');
    return upsert('costs', c, 'cost');
  },
  // 附件传完云存储后回填 fileID（换手机能拉回来）
  setAttachmentFile(id, index, fileID) {
    const c = get('costs', id);
    if (!c || !Array.isArray(c.attachments) || !c.attachments[index]) return null;
    c.attachments[index] = Object.assign({}, c.attachments[index], { fileID });
    c.updatedAt = Date.now();
    save();
    notify('costs', 'upsert', id);
    return c.attachments[index];
  },
  save(c) {
    const exist = c.id ? get('costs', c.id) : null;
    if (!c.dir) c.dir = exist && exist.dir ? exist.dir : 'out';
    const all = allocOf(c);
    c.allocations = all;
    c.amount = all.reduce((s, a) => s + a.amount, 0);
    c.seasonId = all.length ? all[0].seasonId : (c.seasonId || '');
    // 可选字段：未提供时显式清掉（编辑时从"按亩计"改回"直接填"要去掉旧 calc）
    ['calc', 'expr', 'split'].forEach(k => { if (c[k] === undefined || c[k] === null || c[k] === '') c[k] = null; });
    if (exist) {
      if (Math.abs((+exist.amount || 0) - c.amount) > 0.005) pushAudit(c, '改金额', U.money(exist.amount), U.money(c.amount));
      else if (exist.cat !== c.cat || exist.sub !== c.sub) pushAudit(c, '改分类', exist.sub || C.catOf(exist.cat).name, c.sub || C.catOf(c.cat).name);
      else if (exist.date !== c.date) pushAudit(c, '改日期', exist.date, c.date);
      else if ((exist.note || '') !== (c.note || '')) pushAudit(c, '改备注', exist.note || '', c.note || '');
    } else {
      pushAudit(c, '新建', '', '');
    }
    return upsert('costs', c, 'cost');
  },
  remove(id) { return softRemove('costs', id); }
};

// ---------- 农事日志 ----------
// 旧记录的 fertName/fertRate 映射为一条化肥使用明细
function materialsOf(l) {
  if (Array.isArray(l.materials) && l.materials.length) {
    return l.materials.filter(m => m && (m.name || m.rate));
  }
  if (l.fertName) return [{ type: '化肥', name: l.fertName, rate: l.fertRate || '', unit: '斤/亩' }];
  return [];
}
const logs = {
  bySeason(sid) {
    return db().logs.filter(l => !l.deletedAt && l.seasonId === sid)
      .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : (b.date > a.date ? 1 : -1)));
  },
  get(id) { return get('logs', id); },
  materialsOf,
  save(l) { return upsert('logs', l, 'log'); },
  // 软删：保留 logId 关联，恢复后账↔记事的关系还在（关联是否有效由页面查 store.logs.get 判断）
  remove(id) { return softRemove('logs', id); }
};

// ---------- 回收站 ----------
const trash = {
  all() { return trashRows(); },
  count() { return trashRows().length; },
  restore(col, id) { return restoreItem(col, id); },
  // 彻底删除（单条 / 清空）
  purge(col, id) { remove(col, id); },
  empty() {
    trashRows().forEach(r => remove(r.col, r.id));
    return true;
  }
};

// ---------- 库存（农资 / 粮食） ----------
// 存在 tags 里（单文档同步），不新增云端集合
const stock = {
  items() { const t = db().tags; if (!Array.isArray(t.stock)) t.stock = []; return t.stock; },
  inited() { return !!db().tags.stockInit; },
  init(on) { db().tags.stockInit = on !== false; save(); notify('tags', 'upsert', 'tags'); },
  find(name) { return stock.items().find(x => x.name === name); },
  upsert(item) {
    const name = (item.name || '').trim();
    if (!name) return null;
    const list = stock.items();
    const i = list.findIndex(x => x.name === name);
    const prev = i >= 0 ? list[i] : {};
    const pick = (k, dflt) => (item[k] === undefined ? (+prev[k] || dflt) : (+item[k] || 0));
    const rec = {
      name, unit: item.unit || prev.unit || '件',
      warnAt: pick('warnAt', 0), lastPrice: pick('lastPrice', 0), onHand: pick('onHand', 0),
      at: item.at || Date.now()
    };
    if (i >= 0) list[i] = Object.assign({}, list[i], rec);
    else list.push(Object.assign({ id: U.uid('stk') }, rec));
    save(); notify('tags', 'upsert', 'tags');
    return list[i >= 0 ? i : list.length - 1];
  },
  // 出入库：qty 正数入库、负数出库
  applyDelta(name, unit, qty, opts) {
    const it = stock.find(name) || stock.upsert({ name, unit });
    const next = Math.round(((+it.onHand || 0) + (+qty || 0)) * 100) / 100;
    return stock.upsert(Object.assign({}, it, { onHand: next, lastPrice: (opts && opts.price) || it.lastPrice || 0, at: Date.now() }));
  },
  remove(name) {
    const t = db().tags;
    t.stock = stock.items().filter(x => x.name !== name);
    save(); notify('tags', 'upsert', 'tags');
  },
  // 记事里的农资用量 → 库存扣减（可在「类型管理 → 记事类型」关掉）
  // 只认库存里已有的同名品名，不凭记事自动新建品名（避免把备注写进库存）
  // 编辑时先把上次扣的加回来再按新值扣，避免重复扣
  // 注意：删除记事不回滚库存——肥料已经撒地里了，删记事不等于东西回来
  applyLog(log, prevApplied) {
    (prevApplied || []).forEach(a => {
      const it = stock.find(a.name);
      if (it) stock.applyDelta(it.name, it.unit, +a.qty || 0);
    });
    if (!tags.logStock()) return null;
    const area = parseFloat(log.areaMu) || 0;
    if (!(area > 0)) return null;
    const applied = [];
    (log.materials || []).forEach(m => {
      const rate = parseFloat(m.rate);
      const it = m.name ? stock.find(m.name) : null;
      if (!it || !(rate > 0)) return;
      const qty = Math.round(rate * area * 100) / 100;
      stock.applyDelta(it.name, it.unit, -qty);
      applied.push({ name: it.name, qty });
    });
    return applied.length ? applied : null;
  }
};

// ---------- 资金账户（钱在哪个口袋） ----------
// 挂在 tags 单文档，不新增云端集合；余额 = 期初 + Σ收入 − Σ支出（按分摊后金额）
const accounts = {
  items() {
    const t = db().tags;
    if (!Array.isArray(t.accounts) || !t.accounts.length) t.accounts = C.DEFAULT_ACCOUNTS.map(a => Object.assign({}, a));
    return t.accounts;
  },
  get(key) { return accounts.items().find(a => a.key === key) || null; },
  name(key) { const a = accounts.get(key); return a ? a.name : ''; },
  // 账目挂的账户 key（未指定返回 ''）
  keyOf(c) { return (c && c.account) || ''; },
  save(list) {
    db().tags.accounts = (list || []).filter(a => a && a.name).map((a, i) => ({
      key: a.key || ('acc' + Date.now() + i),
      name: String(a.name).trim(),
      init: +a.init || 0
    }));
    save(); notify('tags', 'upsert', 'tags');
    return accounts.items();
  }
};

// ---------- 周期账 / 分期 ----------
// 到期只生成「待记」，不自动落账；lastFiredAt 记最近一次生成日期，纯本机判断
const recurring = {
  items() { const t = db().tags; if (!Array.isArray(t.recurring)) t.recurring = []; return t.recurring; },
  get(id) { return recurring.items().find(x => x.id === id); },
  save(r) {
    const list = recurring.items();
    const rec = Object.assign({ enabled: true, freq: 'month', dir: 'out' }, r);
    const i = rec.id ? list.findIndex(x => x.id === rec.id) : -1;
    if (i >= 0) list[i] = Object.assign({}, list[i], rec);
    else { rec.id = rec.id || U.uid('rec'); list.push(rec); }
    save(); notify('tags', 'upsert', 'tags');
    return rec;
  },
  remove(id) { db().tags.recurring = recurring.items().filter(x => x.id !== id); save(); notify('tags', 'upsert', 'tags'); },
  // 到期判定：起止区间内，按 freq 落到应记日；已 fire 过就跳过
  dueOn(r, date) {
    if (!r || r.enabled === false) return false;
    if (r.startAt && date < r.startAt) return false;
    if (r.endAt && date > r.endAt) return false;
    if (r.lastFiredAt && r.lastFiredAt >= date) return false;
    const day = +r.day || 1;
    const d = U.parse(date);
    if (r.freq === 'week') return d.getDay() === (day % 7);
    if (r.freq === 'month') return d.getDate() === Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
    if (r.freq === 'quarter') return [1, 4, 7, 10].indexOf(d.getMonth() + 1) >= 0 && d.getDate() === Math.min(day, 28);
    if (r.freq === 'year') return d.getMonth() + 1 === 1 && d.getDate() === Math.min(day, 28);
    return false;
  },
  dueList(date) { return recurring.items().filter(r => recurring.dueOn(r, date)); },
  fire(id, date) { const r = recurring.get(id); if (!r) return null; return recurring.save(Object.assign({}, r, { lastFiredAt: date || U.today() })); }
};

// ---------- 天气 ----------
const weather = {
  ofPlot(plotId) { const d = db(); return d.weather[plotId] || (d.weather[plotId] = {}); },
  get(plotId, date) { return weather.ofPlot(plotId)[date]; },
  // 批量写入 API 数据：不覆盖手工修正过的日期
  // opts.fromCloud：数据来自云端（云函数已写库），只更新本地缓存，不进 outbox
  putApi(plotId, map, opts) {
    const w = weather.ofPlot(plotId);
    const fromCloud = opts && opts.fromCloud;
    Object.keys(map).forEach(date => {
      if (w[date] && w[date].src === 'manual') return;
      w[date] = { t: map[date].t, p: map[date].p, wind: map[date].wind, src: 'api', updatedAt: Date.now() };
      if (!fromCloud) notify('weather', 'upsert', weatherId(plotId, date));
    });
    save({ silent: !!fromCloud });
  },
  setManual(plotId, date, t, p, wind) {
    const w = weather.ofPlot(plotId);
    const rec = { t: +t, p: +p, src: 'manual', updatedAt: Date.now() };
    if (wind !== undefined && wind !== '' && !isNaN(+wind)) rec.wind = +wind;
    w[date] = rec;
    save();
    notify('weather', 'upsert', weatherId(plotId, date));
  },
  resetToApi(plotId, date) {
    const w = weather.ofPlot(plotId);
    delete w[date];
    save();
    notify('weather', 'remove', weatherId(plotId, date));
  }
};

// ---------- 农事参谋：任务 ----------
// 规则任务 id 固定为 seasonId#ruleKey（同一季同一规则只一条）；刷新时只在内容变化时写入并进 outbox
const TASK_SYNC_FIELDS = ['title', 'dueStart', 'dueEnd', 'status', 'why', 'steps', 'ref', 'ops', 'matType', 'target', 'userDue', 'logId', 'doneAt', 'reason', 'level'];
const tasks = {
  all() { return db().tasks.slice(); },
  get(id) { return get('tasks', id); },
  bySeason(sid) { return db().tasks.filter(t => t.seasonId === sid); },
  open() { return db().tasks.filter(t => t.status === 'open'); },
  save(t) { if (!t.status) t.status = 'open'; return upsert('tasks', t, 'task'); },
  // 批量合并（规则刷新用）：只写有变化的，统一保存一次
  putMany(list) {
    const d = db(); const changed = [];
    list.forEach(t => {
      const i = d.tasks.findIndex(x => x.id === t.id);
      if (i < 0) { d.tasks.push(Object.assign({ createdAt: Date.now(), updatedAt: Date.now() }, t)); changed.push(t.id); return; }
      const cur = d.tasks[i];
      const diff = TASK_SYNC_FIELDS.some(k => t[k] !== undefined && JSON.stringify(cur[k]) !== JSON.stringify(t[k]));
      if (diff) { d.tasks[i] = Object.assign({}, cur, t, { updatedAt: Date.now() }); changed.push(t.id); }
    });
    if (changed.length) { save(); changed.forEach(id => notify('tasks', 'upsert', id)); }
    return changed.length;
  },
  complete(id, logId, date) { if (!tasks.get(id)) return null; return upsert('tasks', { id, status: 'done', logId: logId || '', doneAt: date || U.today() }); },
  dismiss(id, reason) { if (!tasks.get(id)) return null; return upsert('tasks', { id, status: 'dismissed', reason: reason || '' }); },
  reopen(id) { if (!tasks.get(id)) return null; return upsert('tasks', { id, status: 'open', reason: '' }); },
  setDue(id, start, end) { if (!tasks.get(id)) return null; return upsert('tasks', { id, dueStart: start, dueEnd: end || start, userDue: true, status: 'open' }); },
  rename(id, title) { if (!tasks.get(id)) return null; return upsert('tasks', { id, title }); },
  remove(id) { remove('tasks', id); }
};

// ---------- 农事参谋：记住的 ----------
const memory = {
  all() { return db().memory.slice().sort((a, b) => b.createdAt - a.createdAt); },
  get(id) { return get('memory', id); },
  add(m) {
    const text = (m.text || '').trim(); if (!text) return null;
    const dup = db().memory.find(x => x.text === text && (x.plotId || '') === (m.plotId || ''));
    if (dup) return dup;
    return upsert('memory', { text, plotId: m.plotId || '', seasonId: m.seasonId || '', kind: m.kind || 'note', ruleKey: m.ruleKey || '', source: m.source || '对话' }, 'mem');
  },
  remove(id) { remove('memory', id); },
  suppressed(ruleKey, plotId) { return db().memory.some(x => x.kind === 'suppress' && x.ruleKey === ruleKey && x.plotId === plotId); }
};

// ---------- 自定义类型（tag） ----------
// 记录里直接存类型名称；改名时同步改写历史记录；删除类型时历史记录保留原名
const tags = {
  cost(cat) { const t = db().tags.cost; if (!t[cat]) t[cat] = []; return t[cat]; },
  income() { const t = db().tags; if (!Array.isArray(t.income)) t.income = C.INCOME_CATS.map(c => c.name); return t.income; },
  log() { return db().tags.log; },
  logTag(name) { return db().tags.log.find(t => t.name === name); },
  addCost(cat, name) {
    name = (name || '').trim(); if (!name) return false;
    const list = tags.cost(cat); if (list.indexOf(name) >= 0) return false;
    list.push(name); save(); return true;
  },
  renameCost(cat, from, to) {
    to = (to || '').trim(); const list = tags.cost(cat);
    if (!to || list.indexOf(to) >= 0) return false;
    list[list.indexOf(from)] = to;
    db().costs.forEach(x => {
      if (x.cat === cat && x.sub === from) { x.sub = to; x.updatedAt = Date.now(); notify('costs', 'upsert', x.id); }
    });
    db().tags.log.forEach(t => { if (t.costCat === cat && t.costSub === from) t.costSub = to; });
    save(); return true;
  },
  removeCost(cat, name) {
    const d = db(); d.tags.cost[cat] = tags.cost(cat).filter(n => n !== name);
    d.tags.log.forEach(t => { if (t.costCat === cat && t.costSub === name) t.costSub = ''; });
    save();
  },
  addIncome(name) {
    name = (name || '').trim(); if (!name) return false;
    const list = tags.income(); if (list.indexOf(name) >= 0) return false;
    list.push(name); save(); return true;
  },
  renameIncome(from, to) {
    to = (to || '').trim(); const list = tags.income();
    if (!to || list.indexOf(to) >= 0) return false;
    const i = list.indexOf(from); if (i < 0) return false;
    list[i] = to;
    db().costs.forEach(x => { if (x.dir === 'in' && x.sub === from) { x.sub = to; x.updatedAt = Date.now(); notify('costs', 'upsert', x.id); } });
    save(); return true;
  },
  removeIncome(name) { db().tags.income = tags.income().filter(n => n !== name); save(); },
  // 记事里的农资用量是否自动扣库存（默认开）
  logStock() { return db().tags.logStock !== false; },
  setLogStock(on) { db().tags.logStock = !!on; save(); },
  addLog(t) {
    const name = (t.name || '').trim(); if (!name || tags.logTag(name)) return false;
    const list = db().tags.log;
    list.push({ name, color: t.color || C.TAG_COLORS[list.length % C.TAG_COLORS.length], costCat: t.costCat || '', costSub: t.costSub || '', fields: Array.isArray(t.fields) ? t.fields : [], matType: t.matType || '' });
    save(); return true;
  },
  updateLog(from, patch) {
    const t = tags.logTag(from); if (!t) return false;
    const to = (patch.name || from).trim();
    if (!to || (to !== from && tags.logTag(to))) return false;
    if (to !== from) db().logs.forEach(l => {
      if ((l.ops || []).indexOf(from) >= 0) {
        l.ops = l.ops.map(o => (o === from ? to : o));
        l.updatedAt = Date.now(); notify('logs', 'upsert', l.id);
      }
    });
    Object.assign(t, patch, { name: to });
    save(); return true;
  },
  removeLog(name) { const d = db(); d.tags.log = d.tags.log.filter(t => t.name !== name); save(); },
  // ---- 常用账（模板）----
  templates() { const t = db().tags; if (!Array.isArray(t.templates)) t.templates = []; return t.templates; },
  template(id) { return tags.templates().find(x => x.id === id); },
  saveTemplate(tp) {
    const name = (tp.name || '').trim(); if (!name) return null;
    const list = tags.templates();
    const rec = {
      id: tp.id || U.uid('tpl'), name, dir: tp.dir === 'in' ? 'in' : 'out', cat: tp.cat || 'agri', sub: tp.sub || '',
      mode: tp.mode || 'fixed', unitPrice: +tp.unitPrice || 0, amount: +tp.amount || 0, people: +tp.people || 0,
      split: tp.split || 'current', note: tp.note || ''
    };
    const i = list.findIndex(x => x.id === rec.id);
    if (i >= 0) list[i] = rec; else list.push(rec);
    save(); return rec;
  },
  removeTemplate(id) { const t = db().tags; t.templates = tags.templates().filter(x => x.id !== id); save(); },
  moveTemplate(id, dir) {
    const list = tags.templates(); const i = list.findIndex(x => x.id === id); const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const tmp = list[i]; list[i] = list[j]; list[j] = tmp; save();
  },
  move(kind, cat, name, dir) {
    const list = kind === 'log' ? db().tags.log : tags.cost(cat);
    const i = list.findIndex(x => (typeof x === 'string' ? x : x.name) === name); const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const tmp = list[i]; list[i] = list[j]; list[j] = tmp; save();
  },
  resetDefault() { const keep = tags.templates(); db().tags = defaultTags(); db().tags.templates = keep; save(); },
  colorOf(name) { const t = tags.logTag(name); return t ? t.color : '#9A8F7A'; }
};

// tags 的每个变更出口统一补一条 outbox（每用户单文档，幂等 upsert 整份 tags）
['addCost', 'renameCost', 'removeCost', 'addIncome', 'renameIncome', 'removeIncome', 'addLog', 'updateLog', 'removeLog', 'move', 'resetDefault', 'saveTemplate', 'removeTemplate', 'moveTemplate'].forEach(fn => {
  const orig = tags[fn];
  tags[fn] = function () { const r = orig.apply(tags, arguments); notify('tags', 'upsert', 'tags'); return r; };
});

module.exports = { tasks, memory, tags, costs, stock, accounts, recurring, trash, logs, weather, plots, seasons, db, save, replaceAll, notify, outbox, weatherId, dirOf, isIncome, isDebtOpen, allocTotal, pushAudit, setAuditSrc, TRASH_DAYS, KEY, OUTBOX_KEY };
