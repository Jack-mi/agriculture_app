// 分集合逐条同步引擎 —— 微信云开发
// 未配置 CLOUD_ENV 时为纯本地模式，所有函数安全空转。
//
// 写路径：store 每次变更先进 outbox 队列（store.js notify），这里节流 flush 逐条 upsert/remove 到云端。
// 拉路径：pull() 按 updatedAt > lastPullAt 增量拉取合并，冲突 Last-Write-Wins（手工修正的天气永远赢）。
// 集合：plots / seasons / costs / logs / tasks / memory / weather / tags / users（users 由 login 云函数维护）。
const store = require('./store.js');

let enabled = false;
let busy = false;
let pulling = false;

const COLS = ['plots', 'seasons', 'costs', 'logs', 'tasks', 'memory'];
const LASTPULL_KEY = 'guyuji_lastpull';
const OPENID_KEY = 'guyuji_openid';
const TAGS_DOCID_KEY = 'guyuji_tags_docid';
const DEAD_KEY = 'guyuji_deadletter';
// 单条连续失败上限：超过就从 outbox 挪进死信，否则一条永久性错误（权限/数据问题）
// 会永远卡在队首，后面所有变更都同步不上去
const MAX_FAILS = 5;
// pull 水位线回退窗口：updatedAt 来自各设备本地时钟，时钟偏快会把水位抬高、
// 漏拉其他设备的正常写入。回退 10 分钟重叠拉取，合并是幂等 LWW，重复无害。
const PULL_OVERLAP_MS = 10 * 60 * 1000;
// 硬删除集合（物理 remove，云端不留墓碑）：每天对账一次，清掉别台设备已删的本地幽灵
const HARD_DEL_COLS = ['plots', 'seasons', 'tasks', 'memory'];
const RECONCILE_KEY = 'guyuji_reconcile_date';

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
function dead() { try { return wx.getStorageSync(DEAD_KEY) || []; } catch (e) { return []; } }
// 把失败计数写回存储中的 outbox（e 只是数组副本，直接改不会持久化）
function markFail(entry) {
  const q = outbox();
  const hit = q.find(x => x.col === entry.col && x.id === entry.id && x.at === entry.at);
  const fails = ((hit && hit.fails) || 0) + 1;
  if (hit) { hit.fails = fails; wx.setStorageSync(store.OUTBOX_KEY, q); }
  return fails;
}
function toDead(entry, err) {
  const list = dead();
  list.push({ col: entry.col, op: entry.op, id: entry.id, at: Date.now(), err: String((err && err.errMsg) || (err && err.message) || err).slice(0, 200) });
  wx.setStorageSync(DEAD_KEY, list.slice(-50));
  // 从 outbox 移除该 col+id 的全部条目（含可能存在的更新变更，重试时以最新数据重新入队）
  wx.setStorageSync(store.OUTBOX_KEY, outbox().filter(x => !(x.col === entry.col && x.id === entry.id)));
}
// 死信重新入队（例如权限修复后），返回重新入队条数
function retryDead() {
  const list = dead();
  list.forEach(e => store.notify(e.col, e.op, e.id));
  wx.setStorageSync(DEAD_KEY, []);
  return list.length;
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
  const d = deepClean(rec);
  delete d._openid;
  return d;
}

// 云数据库不接受 undefined 字段（calc / expr / split / 附件 fileID 等可选字段都可能是）
// 深层清洗：对象与数组元素里的 undefined 一并剔除，否则整条写入会失败
function deepClean(v) {
  if (Array.isArray(v)) return v.map(deepClean);
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).forEach(k => { if (v[k] !== undefined) o[k] = deepClean(v[k]); });
    return o;
  }
  return v;
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
        if (markFail(e) > MAX_FAILS) toDead(e, err);
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
  d.tags = { cost: rec.cost || d.tags.cost, log: rec.log || d.tags.log, templates: Array.isArray(rec.templates) ? rec.templates : (d.tags.templates || []), updatedAt: rec.updatedAt };
  return true;
}

async function pull() {
  if (!enabled || pulling) return;
  pulling = true;
  try {
    const since = wx.getStorageSync(LASTPULL_KEY) || 0;
    // 水位线带回退重叠：防止设备时钟偏快漏拉（见 PULL_OVERLAP_MS）
    const querySince = since > PULL_OVERLAP_MS ? since - PULL_OVERLAP_MS : 0;
    let maxAt = since;
    let changed = false;
    for (const name of COLS) {
      const recs = await pullCol(name, querySince).catch(() => []);
      recs.forEach(r => { if ((r.updatedAt || 0) > maxAt) maxAt = r.updatedAt; });
      if (mergeCol(name, recs)) changed = true;
    }
    const wrecs = await pullCol('weather', querySince).catch(() => []);
    wrecs.forEach(r => { if ((r.updatedAt || 0) > maxAt) maxAt = r.updatedAt; });
    if (mergeWeather(wrecs)) changed = true;
    const trecs = await pullCol('tags', 0).catch(() => []); // tags 单文档，全量比对
    if (mergeTags(trecs)) changed = true;
    if (await reconcile()) changed = true;
    if (changed) store.save({ silent: true });
    if (maxAt > since) wx.setStorageSync(LASTPULL_KEY, maxAt);
  } finally {
    pulling = false;
  }
}

// 硬删除对账：plots/seasons/tasks/memory 在云端是物理 remove，别的设备删了这里收不到事件。
// 每天一次拉全量 id 比对：本地有、云端没有、outbox 里也没有待同步变更的，判定为别台设备已删，本地清除。
// 任一步失败都放弃本轮对账（宁可留幽灵，不可误删）。
async function reconcile() {
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  if (wx.getStorageSync(RECONCILE_KEY) === today) return false;
  wx.setStorageSync(RECONCILE_KEY, today);
  const d = store.db();
  const pending = {};
  outbox().forEach(e => { pending[e.col + ':' + e.id] = true; });
  let changed = false;
  for (const name of HARD_DEL_COLS) {
    let ids;
    try {
      const recs = await pullCol(name, 0);
      ids = {};
      recs.forEach(r => { ids[r._id] = true; });
    } catch (e) { return changed; } // 拉不全就不删
    const keep = d[name].filter(x => ids[x.id] || pending[name + ':' + x.id]);
    if (keep.length !== d[name].length) { d[name] = keep; changed = true; }
  }
  return changed;
}

function status() {
  return {
    enabled,
    dirty: outbox().length > 0,
    dead: dead().length,
    syncedAt: wx.getStorageSync('guyuji_synced_at') || 0,
    lastPullAt: wx.getStorageSync(LASTPULL_KEY) || 0
  };
}

module.exports = { init, login, flush, pull, status, retryDead, reconcile };
