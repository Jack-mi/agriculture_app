// Open-Meteo 抓取（零依赖，Node 内置 https）
const https = require('https');

const DAILY = 'temperature_2m_mean,precipitation_sum,wind_speed_10m_max';

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let buf = '';
      res.on('data', c => { buf += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function round1(n) { return Math.round((+n || 0) * 10) / 10; }

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function fmtDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function today() { return fmtDate(new Date()); }
function addDays(s, n) {
  const p = s.split('-');
  const d = new Date(+p[0], +p[1] - 1, +p[2]);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}

// 拉取 [start, end] 的逐日均温/降雨，返回 { 'YYYY-MM-DD': {t, p} }
async function fetchRange(lat, lng, start, end) {
  const t = today();
  if (end > t) end = t;
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat +
    '&longitude=' + lng + '&daily=' + DAILY + '&timezone=Asia%2FShanghai&wind_speed_unit=ms' +
    '&past_days=31&forecast_days=1';
  const r = await getJSON(url);
  const daily = r.daily || {};
  const out = {};
  (daily.time || []).forEach((d, i) => {
    if (d < start || d > end) return;
    const temp = daily.temperature_2m_mean[i];
    if (temp === null || temp === undefined) return;
    out[d] = { t: round1(temp), p: round1(daily.precipitation_sum[i] || 0) };
    const w = (daily.wind_speed_10m_max || [])[i];
    if (w !== null && w !== undefined) out[d].wind = round1(w);
  });
  return out;
}

module.exports = { fetchRange, today, addDays };
