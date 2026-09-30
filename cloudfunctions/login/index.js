// 登录：openid 静默建档
// wx.login 后客户端调用本函数，getWXContext 拿到的 OPENID 即账号唯一标识，
// users 集合 upsert（更新 lastLoginAt）。全程无感、零注册。
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();
  const now = Date.now();
  const col = db.collection('users');

  const q = await col.where({ _openid: OPENID }).limit(1).get();
  if (q.data.length) {
    await col.doc(q.data[0]._id).update({ data: { lastLoginAt: now } });
    return { openid: OPENID, isNew: false, user: q.data[0] };
  }
  const user = { _openid: OPENID, nickName: '', avatarUrl: '', createdAt: now, lastLoginAt: now };
  const r = await col.add({ data: user });
  return { openid: OPENID, isNew: true, user: Object.assign({ _id: r._id }, user) };
};
