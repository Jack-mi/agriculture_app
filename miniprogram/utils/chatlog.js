// 参谋对话按微信账户保存。
// 本机 Storage 跟小程序用户隔离，重开立刻能看到；云端 advisorThreads 按 openid 再存一份，换机也能拉回来。
const OPENID_KEY = 'guyuji_openid';
const LOCAL_KEY = 'guyuji_chat_threads';

function openid() {
  try { return wx.getStorageSync(OPENID_KEY) || ''; } catch (e) { return ''; }
}
function threadKey(ctx) {
  ctx = ctx || {};
  const raw = ctx.taskId ? ('t_' + ctx.taskId) : ctx.seasonId ? ('s_' + ctx.seasonId) : 'g';
  return String(raw).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}
function bucket() {
  try { return wx.getStorageSync(LOCAL_KEY) || {}; } catch (e) { return {}; }
}
function slimMsgs(msgs) {
  return (msgs || []).filter(m => m && !m.thinking).slice(-40).map(m => {
    const c = {
      id: m.id, role: m.role, text: m.text || '',
      reasoning: m.reasoning || '', reasonOpen: !!m.reasonOpen
    };
    if (m.img) c.img = m.img;
    if (m.list) c.list = m.list;
    if (m.cards && m.cards.length) c.cards = m.cards;
    return c;
  });
}
function load(ctx) {
  const all = bucket();
  return all[threadKey(ctx)] || null;
}
function save(ctx, pack) {
  const key = threadKey(ctx);
  const all = bucket();
  const rec = {
    threadKey: key,
    msgs: slimMsgs(pack.msgs),
    history: (pack.history || []).slice(-12),
    cards: pack.cards || {},
    updatedAt: Date.now()
  };
  all[key] = rec;
  try { wx.setStorageSync(LOCAL_KEY, all); } catch (e) {}
  pushCloud(key, rec);
  return rec;
}
function cloudDb() {
  if (!openid() || !wx.cloud || !wx.cloud.database) return null;
  try { return wx.cloud.database(); } catch (e) { return null; }
}
function pushCloud(key, rec) {
  const db = cloudDb();
  if (!db) return;
  const col = db.collection('advisorThreads');
  const data = { threadKey: key, msgs: rec.msgs, history: rec.history, cards: rec.cards, updatedAt: rec.updatedAt };
  col.where({ threadKey: key }).limit(1).get().then(r => {
    const id = r.data && r.data[0] && r.data[0]._id;
    if (id) return col.doc(id).update({ data: data });
    return col.add({ data: data });
  }).catch(() => null);
}
function pull(ctx) {
  const db = cloudDb();
  if (!db) return Promise.resolve(null);
  return db.collection('advisorThreads').where({ threadKey: threadKey(ctx) }).limit(1).get()
    .then(r => (r.data && r.data[0]) || null)
    .catch(() => null);
}

module.exports = { threadKey, load, save, pull };
