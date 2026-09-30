// 分集合逐条同步引擎 —— 微信云开发
// 未配置 CLOUD_ENV 时为纯本地模式，所有函数安全空转。
//
// 写路径：store 每次变更先进 outbox 队列（store.js notify），这里节流 flush 逐条 upsert/remove 到云端。
// 拉路径：pull() 按 updatedAt > lastPullAt 增量拉取合并，冲突 Last-Write-Wins（手工修正的天气永远赢）。
// 集合：plots / seasons / costs / logs / weather / tags / users（users 由 login 云函数维护）。
const store = require('./store.js');

let enabled = false;
let busy = false;
let pulling = false;

const COLS = ['plots', 'seasons', 'costs', 'logs'];
const LASTPULL_KEY = 'guyuji_lastpull';
const OPENID_KEY = 'guyuji_openid';
const TAGS_DOCID_KEY = 'guyuji_tags_docid';

function init(env) {
  if (!env || !wx.cloud) return;
  try {
    wx.cloud.init({ env, traceUser: true });
    enabled = true;
  } catch (e) { enabled = false; }
}

function db() { return wx.cloud.database(); }

// ---------- 登录：openid 静默建档 ----------
function login() {
  if (!enabled) return Promise.resolve(null);
  return wx.cloud.callFunction({ name: 'login' })
    .then(r => {
      const openid = r.result && r.result.openid;
      if (openid) wx.setStorageSync(OPENID_KEY, openid);
      return openid || null;
    })
    .catch(() => null); // 弱网失败不阻塞本地使用，下次启动重试
}

// ---------- outbox ----------
function outbox() { return store.outbox(); }
function dequeue(entry) {
  // 只移除本次成功的那一条（flush 期间若有更新变更，at 更新则保留）
  wx.setStorageSync(store.OUTBOX_KEY,
    outbox().filter(e => !(e.col === entry.col && e.id === entry.id && e.at === entry.at)));
}

// ---------- 写：flush ----------
async function pushOne(e) {
  if (e.col === 'weather') return pushWeather(e);
  if (e.col === 'tags') return pushTags(e);
  const col = db().collection(e.col);
  if (e.op === 'remove') {
    await col.doc(e.id).remove().catch(() => null); // 云端已不存在视为成功
    return;
  }
  const rec = (store.db()[e.col] || []).find(x => x.id === e.id);
  if (!rec) { // 本地已删（例如先改后删），转为删除
    await col.doc(e.id).remove().catch(() => null);
    return;
  }
  await col.doc(e.id).set({ data: strip(rec) });
}

async function pushWeather(e) {
  const col = db().collection('weather');
  const at = e.id.indexOf('@');
  const plotId = e.id.slice(0, at), date = e.id.slice(at + 1);
  if (e.op === 'remove') {
    await col.doc(e.id).remove().catch(() => null);
    return;
  }
  const w = store.weather.get(plotId, date);
  if (!w) { await col.doc(e.id).remove().catch(() => null); return; }
  await col.doc(e.id).set({ data: { plotId, date, t: w.t, p: w.p, wind: w.wind, src: w.src, updatedAt: w.updatedAt || Date.now() } });
}

async function pushTags() {
  const col = db().collection('tags');
  const data = Object.assign({}, store.db().tags, { updatedAt: store.db().updatedAt || Date.now() });
  let id = wx.getStorageSync(TAGS_DOCID_KEY);
  if (!id) {
    const r = await col.limit(1).get().catch(() => ({ data: [] }));
    id = r.data && r.data[0] && r.data[0]._id;
  }
  if (id) {
    await col.doc(id).set({ data });
  } else {
    const r = await col.add({ data });
    id = r._id;
  }
  wx.setStorageSync(TAGS_DOCID_KEY, id);
}

function strip(rec) {
  const d = Object.assign({}, rec);
  delete d._openid;
  return d;
}

// 逐条消费 outbox；任一条失败即中止，保留剩余下次重试
async function flush() {
  if (!enabled || busy) return;
  const q = outbox();
  if (!q.length) return;
  busy = true;
  try {
    const list = q.slice().sort((a, b) => a.at - b.at);
    for (const e of list) {
      try {
        await pushOne(e);
        dequeue(e);
      } catch (err) {
        break; // 弱网失败，剩余条目留在队列
      }
    }
    if (!outbox().length) wx.setStorageSync('guyuji_synced_at', Date.now());
  } finally {
    busy = false;
  }
}

// ---------- 拉：pull（增量，LWW） ----------
async function pullCol(name, since) {
  const _ = db().command;
  const out = [];
  let skip = 0;
  for (let i = 0; i < 20; i++) { // ponytail: 单用户数据量小，20x100 条上限足够；超限再分游标
    const where = since ? { updatedAt: _.gt(since) } : {};
    const r = await db().collection(name).where(where).orderBy('updatedAt', 'asc').skip(skip).limit(100).get();
    out.push.apply(out, r.data);
    if (r.data.length < 100) break;
    skip += r.data.length;
  }
  return out;
}

function mergeCol(name, records) {
  const d = store.db();
  let changed = false;
  records.forEach(rec => {
    const id = rec._id;
    const i = d[name].findIndex(x => x.id === id);
    if (rec.deletedAt) {
      if (i >= 0) { d[name].splice(i, 1); changed = true; }
      return;
    }
    const incoming = strip(rec);
    incoming.id = id;
    delete incoming._id;
    if (i < 0) { d[name].push(incoming); changed = true; }
    else if ((incoming.updatedAt || 0) > (d[name][i].updatedAt || 0)) { d[name][i] = incoming; changed = true; }
  });
  return changed;
}

function mergeWeather(records) {
  const d = store.db();
  let changed = false;
  records.forEach(rec => {
    const at = (rec._id || '').indexOf('@');
    if (at < 0) return;
    const plotId = rec._id.slice(0, at), date = rec._id.slice(at + 1);
    const w = d.weather[plotId] || (d.weather[plotId] = {});
    const local = w[date];
    if (local && local.src === 'manual') return; // 手工修正永远赢
    if (local && (local.updatedAt || 0) >= (rec.updatedAt || 0)) return;
    w[date] = { t: rec.t, p: rec.p, wind: rec.wind, src: rec.src || 'api', updatedAt: rec.updatedAt || 0 };
    changed = true;
  });
  return changed;
}

function mergeTags(records) {
  const rec = records && records[0];
  if (!rec) return false;
  const d = store.db();
  const localAt = (d.tags && d.tags.updatedAt) || 0;
  if ((rec.updatedAt || 0) <= localAt) return false;
  wx.setStorageSync(TAGS_DOCID_KEY, rec._id);
  d.tags = { cost: rec.cost || d.tags.cost, log: rec.log || d.tags.log, updatedAt: rec.updatedAt };
  return true;
}

async function pull() {
  if (!enabled || pulling) return;
  pulling = true;
  try {
    const since = wx.getStorageSync(LASTPULL_KEY) || 0;
    let maxAt = since;
    let changed = false;
    for (const name of COLS) {
      const recs = await pullCol(name, since).catch(() => []);
      recs.forEach(r => { if ((r.updatedAt || 0) > maxAt) maxAt = r.updatedAt; });
      if (mergeCol(name, recs)) changed = true;
    }
    const wrecs = await pullCol('weather', since).catch(() => []);
    wrecs.forEach(r => { if ((r.updatedAt || 0) > maxAt) maxAt = r.updatedAt; });
    if (mergeWeather(wrecs)) changed = true;
    const trecs = await pullCol('tags', 0).catch(() => []); // tags 单文档，全量比对
    if (mergeTags(trecs)) changed = true;
    if (changed) store.save({ silent: true });
    if (maxAt > since) wx.setStorageSync(LASTPULL_KEY, maxAt);
  } finally {
    pulling = false;
  }
}

// 兼容旧调用（app.js）：首拉/恢复 = 全量增量一体的 pull
function pullIfEmpty() { return pull(); }

function status() {
  return {
    enabled,
    dirty: outbox().length > 0,
    syncedAt: wx.getStorageSync('guyuji_synced_at') || 0,
    lastPullAt: wx.getStorageSync(LASTPULL_KEY) || 0
  };
}

module.exports = { init, login, flush, pull, pullIfEmpty, status };
