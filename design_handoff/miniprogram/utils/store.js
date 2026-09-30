// 谷雨记 · 本地数据仓库
// 离线优先：所有读写都先落本地 Storage（弱网/无网可用），再由 sync.js 在联网时备份云端。
//
// 数据结构
// db = {
//   ver, updatedAt,
//   plots:   [{ id, name, area, lat, lng, address, createdAt }],
//   seasons: [{ id, plotId, crop, sowDate, seedRate, tillage, status:'growing'|'done', harvestDate, yieldJin, harvestNote, createdAt }],
//   costs:   [{ id, seasonId, date, cat, sub, amount, people, unitPrice, note, logId, createdAt }],
//   logs:    [{ id, seasonId, date, ops:[], text, fertName, fertRate, moisture, createdAt }],
//   weather: { [plotId]: { [date]: { t, p, src:'api'|'manual' } } }
// }
const U = require('./util.js');
const KEY = 'guyuji_db_v1';

let cache = null;

function empty() {
  return { ver: 1, updatedAt: 0, plots: [], seasons: [], costs: [], logs: [], weather: {} };
}

function db() {
  if (cache) return cache;
  try { cache = wx.getStorageSync(KEY) || empty(); } catch (e) { cache = empty(); }
  ['plots', 'seasons', 'costs', 'logs'].forEach(k => { if (!Array.isArray(cache[k])) cache[k] = []; });
  if (!cache.weather) cache.weather = {};
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
  return item;
}
function remove(list, id) {
  const d = db();
  d[list] = d[list].filter(x => x.id !== id);
  save();
}
function get(list, id) { return db()[list].find(x => x.id === id); }

// ---------- 地块 ----------
const plots = {
  all() { return db().plots.slice().sort((a, b) => a.createdAt - b.createdAt); },
  get(id) { return get('plots', id); },
  save(p) { return upsert('plots', p, 'plot'); },
  remove(id) {
    const d = db();
    const sids = d.seasons.filter(s => s.plotId === id).map(s => s.id);
    d.seasons = d.seasons.filter(s => s.plotId !== id);
    d.costs = d.costs.filter(c => sids.indexOf(c.seasonId) < 0);
    d.logs = d.logs.filter(l => sids.indexOf(l.seasonId) < 0);
    delete d.weather[id];
    d.plots = d.plots.filter(p => p.id !== id);
    save();
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
    d.seasons = d.seasons.filter(s => s.id !== id);
    d.costs = d.costs.filter(c => c.seasonId !== id);
    d.logs = d.logs.filter(l => l.seasonId !== id);
    save();
  },
  // 周期结束日：已收获取收获日，否则取今天
  endDate(s) { return s.status === 'done' && s.harvestDate ? s.harvestDate : U.today(); }
};

// ---------- 记账 ----------
const costs = {
  bySeason(sid) {
    return db().costs.filter(c => c.seasonId === sid)
      .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : (b.date > a.date ? 1 : -1)));
  },
  get(id) { return get('costs', id); },
  save(c) { c.amount = +c.amount || 0; return upsert('costs', c, 'cost'); },
  remove(id) { remove('costs', id); }
};

// ---------- 记事 ----------
const logs = {
  bySeason(sid) {
    return db().logs.filter(l => l.seasonId === sid)
      .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : (b.date > a.date ? 1 : -1)));
  },
  get(id) { return get('logs', id); },
  save(l) { return upsert('logs', l, 'log'); },
  remove(id) {
    const d = db();
    d.costs.forEach(c => { if (c.logId === id) c.logId = ''; });
    remove('logs', id);
  }
};

// ---------- 天气 ----------
const weather = {
  ofPlot(plotId) { const d = db(); return d.weather[plotId] || (d.weather[plotId] = {}); },
  get(plotId, date) { return weather.ofPlot(plotId)[date]; },
  // 批量写入 API 数据：不覆盖手工修正过的日期
  putApi(plotId, map) {
    const w = weather.ofPlot(plotId);
    Object.keys(map).forEach(date => {
      if (w[date] && w[date].src === 'manual') return;
      w[date] = { t: map[date].t, p: map[date].p, src: 'api' };
    });
    save({ silent: false });
  },
  setManual(plotId, date, t, p) {
    const w = weather.ofPlot(plotId);
    w[date] = { t: +t, p: +p, src: 'manual' };
    save();
  },
  resetToApi(plotId, date) {
    const w = weather.ofPlot(plotId);
    delete w[date];
    save();
  }
};

module.exports = { db, save, replaceAll, plots, seasons, costs, logs, weather, KEY };
