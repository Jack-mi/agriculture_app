// Open-Meteo 抓取（零依赖，Node 内置 https）
const https = require('https');

const DAILY = 'temperature_2m_mean,precipitation_sum,wind_speed_10m_max';

// WMO weathercode → 中文天气短语（订阅消息 phrase 字段限 5 字）
const WX_CODES = [
  [0, '晴'], [1, '多云'], [2, '多云'], [3, '阴'],
  [45, '雾'], [48, '雾'],
  [51, '毛毛雨'], [53, '毛毛雨'], [55, '毛毛雨'], [56, '冻雨'], [57, '冻雨'],
  [61, '小雨'], [63, '中雨'], [65, '大雨'], [66, '冻雨'], [67, '冻雨'],
  [71, '小雪'], [73, '中雪'], [75, '大雪'], [77, '雪'],
  [80, '阵雨'], [81, '阵雨'], [82, '暴雨'],
  [85, '阵雪'], [86, '阵雪'],
  [95, '雷雨'], [96, '雷雨'], [99, '雷雨']
];
function wxText(code) {
  const hit = WX_CODES.find(x => x[0] === code);
  return hit ? hit[1] : '多云';
}

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

// 未来 N 天逐日预报（订阅消息推送 + 灾害预警用）：最高/最低温、降雨、风、天气现象
async function fetchForecast(lat, lng, days) {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat +
    '&longitude=' + lng + '&daily=temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weathercode' +
    '&timezone=Asia%2FShanghai&wind_speed_unit=ms&forecast_days=' + (days || 10);
  const r = await getJSON(url);
  const d = r.daily || {};
  return (d.time || []).map((date, i) => ({
    date,
    t: round1(d.temperature_2m_mean[i]),
    tmin: round1(d.temperature_2m_min[i]),
    tmax: round1(d.temperature_2m_max[i]),
    p: round1((d.precipitation_sum || [])[i] || 0),
    wind: round1((d.wind_speed_10m_max || [])[i]),
    wx: wxText((d.weathercode || [])[i])
  }));
}

module.exports.fetchForecast = fetchForecast;
module.exports.wxText = wxText;
