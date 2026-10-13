// 登录：openid 静默建档
// wx.login 后客户端调用本函数，getWXContext 拿到的 OPENID 即账号唯一标识，
// users 集合 upsert（更新 lastLoginAt）。全程无感、零注册。
// 可选传入 { nickName, avatarUrl } 更新资料（头像客户端先传云存储，这里只存 fileID）。
// 可选传入 { subInc: { weather|task|alert: 1..5 } }：订阅消息额度累加（一次性订阅，
// 用户点一次允许 = 1 次推送额度；weatherDaily 发送成功时扣减）。
// users._openid 有唯一索引：并发首登时 add 撞索引即重查更新，不会重复建档。
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const SUB_KINDS = ['weather', 'task', 'alert'];
function subIncOf(event) {
  const out = {};
  const raw = event && event.subInc;
  if (!raw || typeof raw !== 'object') return out;
  SUB_KINDS.forEach(k => {
    const n = Math.floor(+raw[k]);
    if (n > 0) out[k] = Math.min(n, 5); // 单次最多补 5 条，防客户端异常刷额度
  });
  return out;
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const now = Date.now();
  const col = db.collection('users');
  const profile = {};
  if (event && typeof event.nickName === 'string' && event.nickName.trim()) profile.nickName = event.nickName.trim().slice(0, 32);
  if (event && typeof event.avatarUrl === 'string' && event.avatarUrl) profile.avatarUrl = event.avatarUrl;
  const inc = subIncOf(event);
  const incPatch = {};
  Object.keys(inc).forEach(k => { incPatch['subs.' + k] = _.inc(inc[k]); });

  const q = await col.where({ _openid: OPENID }).get();
  if (q.data.length) {
    // 历史并发重复建档的兜底清理：保留最早一条，其余删掉（唯一索引已防新增）
    if (q.data.length > 1) {
      const keep = q.data.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0];
      await Promise.all(q.data.filter(x => x._id !== keep._id)
        .map(x => col.doc(x._id).remove().catch(() => null)));
      q.data = [keep];
    }
    const upd = Object.assign({ lastLoginAt: now }, profile, incPatch);
    await col.doc(q.data[0]._id).update({ data: upd });
    // 有额度变动时重读一次，把最新 subs 带回客户端（本地据此决定何时再请用户订阅）
    const fresh = Object.keys(inc).length
      ? await col.doc(q.data[0]._id).get().then(r => r.data).catch(() => q.data[0])
      : q.data[0];
    return { openid: OPENID, isNew: false, user: Object.assign({}, fresh, profile) };
  }
  const subs = { weather: 0, task: 0, alert: 0 };
  Object.keys(inc).forEach(k => { subs[k] = inc[k]; });
  const user = Object.assign({ _openid: OPENID, nickName: '', avatarUrl: '', createdAt: now, lastLoginAt: now, subs }, profile);
  try {
    const r = await col.add({ data: user });
    return { openid: OPENID, isNew: true, user: Object.assign({ _id: r._id }, user) };
  } catch (e) {
    // 并发首登：另一请求已先建档（撞 _openid 唯一索引），重查后走更新路径
    const q2 = await col.where({ _openid: OPENID }).limit(1).get();
    if (!q2.data.length) throw e;
    await col.doc(q2.data[0]._id).update({ data: Object.assign({ lastLoginAt: now }, profile, incPatch) });
    return { openid: OPENID, isNew: false, user: Object.assign({}, q2.data[0], profile) };
  }
};
