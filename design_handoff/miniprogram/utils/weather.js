// 天气自动获取 —— Open-Meteo（开源、免费、无需 API Key）
// 需要在小程序后台「开发管理 → 开发设置 → 服务器域名 → request 合法域名」中添加：
//   https://api.open-meteo.com
//   https://archive-api.open-meteo.com
//
// 策略：
//  · 近 30 天：forecast 接口 past_days（实况，当天即有）
//  · 更早日期：archive 历史接口（ERA5 再分析，约有 5 天延迟，与上面重叠覆盖）
//  · 已有数据的日期不重复请求；手工修正过的日期永不被覆盖
const U = require('./util.js');
const store = require('./store.js');

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const DAILY = 'temperature_2m_mean,precipitation_sum';

function req(url, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url, data, timeout: 15000,
      success: r => (r.statusCode === 200 && r.data && r.data.daily) ? resolve(r.data.daily) : reject(r),
      fail: reject
    });
  });
}

function toMap(daily) {
  const map = {};
  (daily.time || []).forEach((d, i) => {
    const t = daily.temperature_2m_mean[i];
    const p = daily.precipitation_sum[i];
    if (t === null || t === undefined) return;
    map[d] = { t: U.round1(t), p: U.round1(p || 0) };
  });
  return map;
}

// 为某个种植季补齐天气（播种日 → 收获日/今天）
async function fillSeason(season, opts) {
  const plot = store.plots.get(season.plotId);
  if (!plot || plot.lat === undefined || plot.lat === null || plot.lat === '') return { ok: false, reason: 'nolocation' };
  const force = opts && opts.force;
  const today = U.today();
  const end = store.seasons.endDate(season) > today ? today : store.seasons.endDate(season);
  const days = U.range(season.sowDate, end);
  const w = store.weather.ofPlot(plot.id);
  const missing = force ? days : days.filter(d => !w[d] || (w[d].src === 'api' && d >= U.addDays(today, -1)));
  if (!missing.length) return { ok: true, added: 0 };

  const base = { latitude: plot.lat, longitude: plot.lng, daily: DAILY, timezone: 'Asia/Shanghai' };
  const recentStart = U.addDays(today, -30);
  const old = missing.filter(d => d < recentStart);
  const merged = {};
  const tasks = [];

  if (old.length) {
    tasks.push(req(ARCHIVE, Object.assign({}, base, { start_date: old[0], end_date: old[old.length - 1] }))
      .then(d => Object.assign(merged, toMap(d))).catch(() => null));
  }
  if (missing.some(d => d >= recentStart)) {
    tasks.push(req(FORECAST, Object.assign({}, base, { past_days: 31, forecast_days: 1 }))
      .then(d => {
        const m = toMap(d);
        Object.keys(m).forEach(k => { if (k <= today) merged[k] = m[k]; });
      }).catch(() => null));
  }
  await Promise.all(tasks);
  const keys = Object.keys(merged).filter(k => k >= season.sowDate && k <= end);
  if (!keys.length) return { ok: false, reason: 'network' };
  const put = {};
  keys.forEach(k => { put[k] = merged[k]; });
  store.weather.putApi(plot.id, put);
  return { ok: true, added: keys.length };
}

// 首页用：刷新所有在种的季
function fillAllGrowing() {
  return Promise.all(store.seasons.growing().map(s => fillSeason(s).catch(() => null)));
}

module.exports = { fillSeason, fillAllGrowing };
