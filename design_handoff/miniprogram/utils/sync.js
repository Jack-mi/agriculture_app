// 云端备份（可选）—— 微信云开发
// 未配置 CLOUD_ENV 时为纯本地模式，所有函数安全空转。
// 配置后：数据库集合 guyuji_userdata（权限：仅创建者可读写），每个用户一条文档，按 _openid 天然隔离。
const store = require('./store.js');

let enabled = false;
let busy = false;
const COL = 'guyuji_userdata';

function init(env) {
  if (!env || !wx.cloud) return;
  try {
    wx.cloud.init({ env, traceUser: true });
    enabled = true;
  } catch (e) { enabled = false; }
}

function col() { return wx.cloud.database().collection(COL); }

// 新设备首次打开且本地为空时，从云端恢复
async function pullIfEmpty() {
  if (!enabled) return;
  const local = store.db();
  if (local.plots.length) return;
  try {
    const r = await col().limit(1).get();
    if (r.data && r.data[0] && r.data[0].payload) {
      wx.setStorageSync('guyuji_docid', r.data[0]._id);
      store.replaceAll(JSON.parse(r.data[0].payload));
    }
  } catch (e) { /* 离线忽略 */ }
}

async function flush() {
  if (!enabled || busy) return;
  if (!wx.getStorageSync('guyuji_dirty')) return;
  busy = true;
  try {
    const payload = JSON.stringify(store.db());
    const data = { payload, updatedAt: Date.now() };
    let id = wx.getStorageSync('guyuji_docid');
    if (!id) {
      const r = await col().limit(1).get();
      id = r.data && r.data[0] && r.data[0]._id;
    }
    if (id) await col().doc(id).update({ data });
    else {
      const r = await col().add({ data });
      id = r._id;
    }
    wx.setStorageSync('guyuji_docid', id);
    wx.setStorageSync('guyuji_dirty', 0);
    wx.setStorageSync('guyuji_synced_at', Date.now());
  } catch (e) { /* 弱网失败，下次联网重试 */ }
  busy = false;
}

function status() {
  return {
    enabled,
    dirty: !!wx.getStorageSync('guyuji_dirty'),
    syncedAt: wx.getStorageSync('guyuji_synced_at') || 0
  };
}

module.exports = { init, pullIfEmpty, flush, status };
