// Open-Meteo 抓取（零依赖，Node 内置 https）
//  · 近 31 天：forecast 接口 past_days（实况，当天即有）
//  · 更早日期：archive 历史接口（ERA5 再分析，约有 5 天延迟）
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

function toMap(daily) {
  const map = {};
  (daily.time || []).forEach((d, i) => {
    const t = daily.temperature_2m_mean[i];
    const p = daily.precipitation_sum[i];
    if (t === null || t === undefined) return;
    const w = (daily.wind_speed_10m_max || [])[i];
    map[d] = { t: round1(t), p: round1(p || 0) };
    if (w !== null && w !== undefined) map[d].wind = round1(w);
  });
  return map;
}

// 拉取 [start, end] 的逐日均温/降雨，返回 { 'YYYY-MM-DD': {t, p} }
async function fetchRange(lat, lng, start, end) {
  const t = today();
  if (end > t) end = t;
  const merged = {};
  const recentStart = addDays(t, -30);
  const tasks = [];

  if (start < recentStart) {
    const oldEnd = end < recentStart ? end : addDays(recentStart, -1);
    const url = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + lat +
      '&longitude=' + lng + '&daily=' + DAILY + '&timezone=Asia%2FShanghai&wind_speed_unit=ms' +
      '&start_date=' + start + '&end_date=' + oldEnd;
    tasks.push(getJSON(url).then(r => Object.assign(merged, toMap(r.daily || {}))).catch(() => null));
  }
  if (end >= recentStart) {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat +
      '&longitude=' + lng + '&daily=' + DAILY + '&timezone=Asia%2FShanghai&wind_speed_unit=ms' +
      '&past_days=31&forecast_days=1';
    tasks.push(getJSON(url).then(r => {
      const m = toMap(r.daily || {});
      Object.keys(m).forEach(k => { if (k <= t && k >= start) merged[k] = m[k]; });
    }).catch(() => null));
  }
  await Promise.all(tasks);
  const out = {};
  Object.keys(merged).forEach(k => { if (k >= start && k <= end) out[k] = merged[k]; });
  return out;
}

module.exports = { fetchRange, today, addDays };
