// 每日 06:30 定时触发：扫描所有在种的季，为对应地块拉取昨日天气写入 weather 集合。
// 服务端 admin 权限扫描全量用户；src=manual 的手工修正记录永不覆盖。
// 写入的 weather 文档带该地块属主的 _openid，否则客户端按「仅创建者可读写」拉不到。
const cloud = require('wx-server-sdk');
const meteo = require('./meteo.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const yesterday = meteo.addDays(meteo.today(), -1);

  // 所有在种的季 → 去重的地块 id
  const seasons = await db.collection('seasons').where({ status: 'growing' }).limit(1000).get()
    .catch(() => ({ data: [] }));
  const plotIds = [];
  seasons.data.forEach(s => { if (s.plotId && plotIds.indexOf(s.plotId) < 0) plotIds.push(s.plotId); });
  if (!plotIds.length) return { ok: true, plots: 0, updated: 0 };

  const col = db.collection('weather');
  const now = Date.now();
  let updated = 0;

  for (const plotId of plotIds) {
    const plot = await db.collection('plots').doc(plotId).get().then(r => r.data).catch(() => null);
    if (!plot || plot.lat === undefined || plot.lat === null || plot.lat === '') continue;

    // 已有记录且为 manual 则跳过
    const docId = plotId + '@' + yesterday;
    const exist = await col.doc(docId).get().then(r => r.data).catch(() => null);
    if (exist && exist.src === 'manual') continue;

    const map = await meteo.fetchRange(plot.lat, plot.lng, yesterday, yesterday).catch(() => ({}));
    if (!map[yesterday]) continue;

    await col.doc(docId).set({
      data: { _openid: plot._openid || '', plotId, date: yesterday, t: map[yesterday].t, p: map[yesterday].p, wind: map[yesterday].wind, src: 'api', updatedAt: now }
    }).catch(() => null);
    updated++;
  }
  return { ok: true, plots: plotIds.length, updated };
};
