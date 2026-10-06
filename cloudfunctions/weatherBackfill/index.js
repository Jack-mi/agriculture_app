// 开季回补 / 「重新获取天气」按钮：为某地块拉取 [start, end] 的逐日天气并写入 weather 集合。
// src=manual（用户手工修正）的记录永不覆盖。
// 安全（2026-10-06 加固）：只能操作本人地块；写入的 weather 文档带 _openid，
// 否则「仅创建者可读写」权限下客户端和 advisorAgent 都读不到这些记录。
const cloud = require('wx-server-sdk');
const meteo = require('./meteo.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { plotId, start, end } = event;
  if (!plotId || !start || !end) return { ok: false, reason: 'badargs', map: {} };
  const openid = (cloud.getWXContext() || {}).OPENID || '';
  if (!openid) return { ok: false, reason: 'noauth', map: {} };

  const plot = await db.collection('plots').doc(plotId).get().then(r => r.data).catch(() => null);
  if (!plot || plot.lat === undefined || plot.lat === null || plot.lat === '') {
    return { ok: false, reason: 'nolocation', map: {} };
  }
  if (plot._openid && plot._openid !== openid) return { ok: false, reason: 'forbidden', map: {} };

  const map = await meteo.fetchRange(plot.lat, plot.lng, start, end);
  const dates = Object.keys(map);
  if (!dates.length) return { ok: false, reason: 'upstream', map: {} };

  // 查已有记录，跳过 manual
  const col = db.collection('weather');
  const _ = db.command;
  const exist = await col.where({ plotId, date: _.in(dates) }).limit(1000).get().catch(() => ({ data: [] }));
  const manualDates = {};
  exist.data.forEach(r => { if (r.src === 'manual') manualDates[r.date] = true; });

  const now = Date.now();
  let added = 0;
  for (const date of dates) {
    if (manualDates[date]) continue;
    await col.doc(plotId + '@' + date).set({
      data: { _openid: openid, plotId, date, t: map[date].t, p: map[date].p, wind: map[date].wind, src: 'api', updatedAt: now }
    }).catch(() => null);
    added++;
  }
  return { ok: true, added, map };
};
