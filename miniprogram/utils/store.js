// 谷雨记 · 本地数据仓库
// 离线优先：所有读写都先落本地 Storage（弱网/无网可用），再由 sync.js 在联网时备份云端。
//
// 数据结构
// db = {
//   ver, updatedAt,
//   plots:   [{ id, name, area, lat, lng, address, createdAt }],
//   seasons: [{ id, plotId, crop, variety(品种，选填), sowDate, seedRate, tillage, status:'growing'|'done', harvestDate, yieldJin, harvestNote, createdAt }],
//   costs:   [{ id, seasonId(兼容), allocations:[{seasonId, amount}], date, cat, sub, amount(=分摊合计), people, unitPrice, note, logId, createdAt }],
//   logs:    [{ id, seasonId, date, ops:[], text, growth, pest, machine, areaMu, materials:[{type,name,rate,unit}], moisture, fertName/fertRate(旧字段兼容), createdAt }],
//   weather: { [plotId]: { [date]: { t, p, wind, src:'api'|'manual' } } },
//   tags:    { cost: { [catKey]: ['种子', ...] }, log: [{ name, color, costCat, costSub }],
//              templates: [{ id, name, cat, sub, mode:'fixed'|'perMu'|'perDay', unitPrice, amount, people, split:'current'|'area'|'even', note }] }   // 用户自定义类型 + 常用账
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
  return { cost, log: C.DEFAULT_LOG_TAGS.map(t => Object.assign({}, t)), templates: [] };
}

function empty() {
  return { ver: 1, updatedAt: 0, plots: [], seasons: [], costs: [], logs: [], weather: {}, tags: defaultTags() };
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
  ['plots', 'seasons', 'costs', 'logs'].forEach(k => { if (!Array.isArray(cache[k])) cache[k] = []; });
  if (!cache.weather) cache.weather = {};
  if (!cache.tags) cache.tags = defaultTags();
  if (!Array.isArray(cache.tags.templates)) cache.tags.templates = [];
  // 默认记事类型补齐（老库新增「播种/收获/病虫害观察」等）
  C.DEFAULT_LOG_TAGS.forEach(t => {
    if (!cache.tags.log.some(x => x.name === t.name)) cache.tags.log.push(Object.assign({}, t));
  });
  return cache;
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
  cache = Object.assign(empty(), data || {});
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
    d.seasons = d.seasons.filter(s => s.plotId !== id);
    const cids = dropAllocations(d, sids);
    d.logs = d.logs.filter(l => sids.indexOf(l.seasonId) < 0);
    delete d.weather[id];
    d.plots = d.plots.filter(p => p.id !== id);
    save();
    cids.removed.forEach(x => notify('costs', 'remove', x));
    cids.updated.forEach(x => notify('costs', 'upsert', x));
    lids.forEach(x => notify('logs', 'remove', x));
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
    d.seasons = d.seasons.filter(s => s.id !== id);
    d.logs = d.logs.filter(l => l.seasonId !== id);
    save();
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
  endDate(s) { return s.status === 'done' && s.harvestDate ? s.harvestDate : U.today(); }
};

// ---------- 记账 ----------
const costs = {
  bySeason(sid) {
    return db().costs.filter(c => allocOf(c).some(a => a.seasonId === sid))
      .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : (b.date > a.date ? 1 : -1)));
  },
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
  save(c) {
    const all = allocOf(c);
    c.allocations = all;
    c.amount = all.reduce((s, a) => s + a.amount, 0);
    c.seasonId = all.length ? all[0].seasonId : (c.seasonId || '');
    // 可选字段：未提供时显式清掉（编辑时从"按亩计"改回"直接填"要去掉旧 calc）
    ['calc', 'expr', 'split'].forEach(k => { if (c[k] === undefined || c[k] === null || c[k] === '') c[k] = null; });
    return upsert('costs', c, 'cost');
  },
  remove(id) { remove('costs', id); }
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
    return db().logs.filter(l => l.seasonId === sid)
      .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : (b.date > a.date ? 1 : -1)));
  },
  get(id) { return get('logs', id); },
  materialsOf,
  save(l) { return upsert('logs', l, 'log'); },
  remove(id) {
    const d = db();
    d.costs.forEach(c => {
      if (c.logId === id) { c.logId = ''; c.updatedAt = Date.now(); notify('costs', 'upsert', c.id); }
    });
    remove('logs', id);
  }
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

// ---------- 自定义类型（tag） ----------
// 记录里直接存类型名称；改名时同步改写历史记录；删除类型时历史记录保留原名
const tags = {
  cost(cat) { const t = db().tags.cost; if (!t[cat]) t[cat] = []; return t[cat]; },
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
  addLog(t) {
    const name = (t.name || '').trim(); if (!name || tags.logTag(name)) return false;
    const list = db().tags.log;
    list.push({ name, color: t.color || C.TAG_COLORS[list.length % C.TAG_COLORS.length], costCat: t.costCat || '', costSub: t.costSub || '' });
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
      id: tp.id || U.uid('tpl'), name, cat: tp.cat || 'agri', sub: tp.sub || '',
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
['addCost', 'renameCost', 'removeCost', 'addLog', 'updateLog', 'removeLog', 'move', 'resetDefault', 'saveTemplate', 'removeTemplate', 'moveTemplate'].forEach(fn => {
  const orig = tags[fn];
  tags[fn] = function () { const r = orig.apply(tags, arguments); notify('tags', 'upsert', 'tags'); return r; };
});

module.exports = { tags, db, save, replaceAll, plots, seasons, costs, logs, weather, notify, outbox, weatherId, KEY, OUTBOX_KEY };
