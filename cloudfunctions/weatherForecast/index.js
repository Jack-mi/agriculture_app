// 未来 16 天天气预报（农事参谋：生育期预测 + 天气预警用）
// 入参 { lat, lng }；返回 { ok, days: [{ date, t, tmax, tmin, p, wind }] }
// 只读 Open-Meteo，不写数据库；客户端每天缓存一次
const https = require('https');

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let buf = '';
      res.on('data', c => { buf += c; });
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
const r1 = n => (n === null || n === undefined ? null : Math.round(n * 10) / 10);

exports.main = async (event) => {
  const lat = +event.lat, lng = +event.lng;
  if (!isFinite(lat) || !isFinite(lng)) return { ok: false, reason: 'badargs', days: [] };
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lng +
    '&daily=temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max' +
    '&timezone=Asia%2FShanghai&wind_speed_unit=ms&forecast_days=16';
  try {
    const r = await getJSON(url);
    const d = r.daily || {};
    const days = (d.time || []).map((date, i) => ({
      date, t: r1(d.temperature_2m_mean[i]), tmax: r1(d.temperature_2m_max[i]), tmin: r1(d.temperature_2m_min[i]),
      p: r1(d.precipitation_sum[i] || 0), wind: r1(d.wind_speed_10m_max[i])
    }));
    return { ok: days.length > 0, days };
  } catch (e) {
    return { ok: false, reason: 'upstream', days: [] };
  }
};
