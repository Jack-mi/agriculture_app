// 天气获取 —— 统一走 weatherBackfill 云函数（服务端调 Open-Meteo，免配 request 合法域名）。
// 自动回填以客户端为准：每次打开小程序（每天首次）补一次在种季的昨日天气 + 缺失日期（bootFill）。
// 若额外部署了 weatherDaily 定时触发器，也只是提前把数据写好，客户端逻辑照常幂等。
// 策略：
//  · 云函数写入 weather 集合后，返回的 map 同步进本地缓存（fromCloud，不进 outbox）
//  · 已有数据的日期不重复请求；手工修正过的日期永不被覆盖（云函数同样跳过 manual）
//  · 未配置云环境（纯本地模式）时天气不可用，其余功能不受影响
const U = require('./util.js');
const store = require('./store.js');
const sync = require('./sync.js');

function cloudReady() { return sync.status().enabled; }

// 为某个种植季补齐天气（播种日 → 收获日/今天）
async function fillSeason(season, opts) {
  const plot = store.plots.get(season.plotId);
  if (!plot || plot.lat === undefined || plot.lat === null || plot.lat === '') return { ok: false, reason: 'nolocation' };
  if (!cloudReady()) return { ok: false, reason: 'nocloud' };
  const force = opts && opts.force;
  const today = U.today();
  const end = store.seasons.endDate(season) > today ? today : store.seasons.endDate(season);
  const days = U.range(season.sowDate, end);
  const w = store.weather.ofPlot(plot.id);
  const missing = force ? days : days.filter(d => !w[d] || (w[d].src === 'api' && d >= U.addDays(today, -1)));
  if (!missing.length) return { ok: true, added: 0 };

  try {
    const r = await wx.cloud.callFunction({
      name: 'weatherBackfill',
      data: { plotId: plot.id, start: missing[0], end: missing[missing.length - 1] }
    });
    const map = (r.result && r.result.map) || {};
    const keys = Object.keys(map).filter(k => k >= season.sowDate && k <= end);
    if (!keys.length) return { ok: false, reason: 'network' };
    const put = {};
    keys.forEach(k => { put[k] = map[k]; });
    store.weather.putApi(plot.id, put, { fromCloud: true });
    return { ok: true, added: keys.length };
  } catch (e) {
    return { ok: false, reason: 'network' };
  }
}

// 首页用：刷新所有在种的季
function fillAllGrowing() {
  return Promise.all(store.seasons.growing().map(s => fillSeason(s).catch(() => null)));
}

// 启动兜底：每天首次打开小程序时，为所有在种的季补齐昨日 + 缺失天气（不依赖定时触发器）
const BOOT_KEY = 'guyuji_wx_bootdate';
function bootFill() {
  if (!cloudReady()) return Promise.resolve(null);
  const today = U.today();
  if (wx.getStorageSync(BOOT_KEY) === today) return Promise.resolve(null); // 每天只跑一次
  wx.setStorageSync(BOOT_KEY, today);
  return fillAllGrowing();
}

module.exports = { fillSeason, fillAllGrowing, bootFill };
