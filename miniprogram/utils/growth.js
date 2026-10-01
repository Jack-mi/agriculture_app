// 农事参谋 · 生育期引擎（纯函数 + 读 store，无网络）
// 阈值/品种系数/积温口径在 miniprogram/kb/stages.js（可插拔，标定只改那里）
const U = require('./util.js');
const store = require('./store.js');
const { CROP_GDD, STAGES, VARIETY_FACTOR } = require('../kb');

function dayGdd(crop, t) {
  const c = CROP_GDD[crop] || CROP_GDD.wheat;
  if (t === null || t === undefined || isNaN(+t)) return 0;
  return Math.max(0, Math.min(+t, c.cap) - c.base);
}

function stagesOf(season) {
  const list = STAGES[season.crop] || STAGES.wheat;
  const f = (VARIETY_FACTOR[season.crop] || {})[(season.variety || '').trim()];
  const factor = f || 1;
  return { list: list.map(s => Object.assign({}, s, { gdd: Math.round(s.gdd * factor) })), known: !!f || !season.variety };
}

// 实况累计：播种日 → min(今天, 季末)；缺天气的日子用前后均值近似并计数
function actual(season) {
  const w = store.weather.ofPlot(season.plotId);
  const today = U.today();
  let end = store.seasons.endDate(season); if (end > today) end = today;
  const days = U.range(season.sowDate, end);
  let g = 0, missing = 0, last = null;
  const series = [];
  days.forEach(d => {
    const v = w[d];
    let t = v ? v.t : null;
    if (t === null) { missing++; t = last; }
    if (t !== null) { g += dayGdd(season.crop, t); last = t; }
    series.push({ date: d, gdd: Math.round(g) });
  });
  return { gdd: g, series, missing, days: days.length, end };
}

// 校准：农户说"现在是 X 阶段"，记录偏移量 = 该阶段阈值 - 当日实况累计
function offsetOf(season) {
  const c = season.stageCalib;
  if (!c || !c.stage) return 0;
  const st = stagesOf(season).list.find(s => s.key === c.stage);
  if (!st) return 0;
  return st.gdd - (+c.gddAt || 0);
}

// 当前生育期：{ stage, next, idx, gdd, pct, eta, etaSpan, missing, calibrated, varietyKnown }
// forecast: [{date, t}]（可选），用于预测下一阶段日期；超出预报用近 7 日均值外推
function current(season, forecast) {
  const a = actual(season);
  const off = offsetOf(season);
  const g = a.gdd + off;
  const { list, known } = stagesOf(season);
  let idx = 0;
  for (let i = 0; i < list.length; i++) if (g >= list[i].gdd) idx = i;
  const stage = list[idx], next = list[idx + 1] || null;
  const span = next ? next.gdd - stage.gdd : 1;
  const pct = next ? Math.max(0, Math.min(100, Math.round((g - stage.gdd) / span * 100))) : 100;
  const total = list[list.length - 1].gdd || 1;
  let eta = null, etaSpan = 0;
  if (next && season.status !== 'done') {
    eta = projectDate(season, g, next.gdd, forecast, a);
    etaSpan = eta && eta.fromForecast ? 2 : 4;
  }
  return {
    stage, next, idx, list, gdd: Math.round(g), pct, overall: Math.min(100, Math.round(g / total * 100)),
    eta: eta ? eta.date : '', etaSpan, missing: a.missing, calibrated: !!off, varietyKnown: known
  };
}

// 预测累计达到 targetGdd 的日期
function projectDate(season, gNow, target, forecast, act) {
  if (gNow >= target) return { date: U.today(), fromForecast: true };
  let g = gNow, d = U.today();
  const fc = (forecast || []).filter(x => x.date > U.today());
  for (const f of fc) {
    g += dayGdd(season.crop, f.t);
    d = f.date;
    if (g >= target) return { date: d, fromForecast: true };
  }
  // 预报之外：近 7 日实况均温外推（最多 240 天）
  const w = store.weather.ofPlot(season.plotId);
  const recent = [];
  for (let i = 0; i < 7; i++) { const v = w[U.addDays(U.today(), -i)]; if (v) recent.push(v.t); }
  const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
  if (avg === null) return null;
  const per = dayGdd(season.crop, avg);
  if (per <= 0.2) return null; // 越冬等停滞期不给日期
  for (let i = 0; i < 240; i++) {
    d = U.addDays(d, 1); g += per;
    if (g >= target) return { date: d, fromForecast: false };
  }
  return null;
}

// 记录校准：以今天实况累计为基准
function calibrate(season, stageKey) {
  const a = actual(season);
  const list = stagesOf(season).list;
  const st = list.find(s => s.key === stageKey);
  if (!st) return null;
  const before = current(season);
  store.seasons.save({ id: season.id, stageCalib: { stage: stageKey, date: U.today(), gddAt: Math.round(a.gdd) } });
  const after = current(store.seasons.get(season.id));
  return { before, after, diffGdd: Math.round(st.gdd - a.gdd) };
}

function stageByName(crop, text) {
  const list = STAGES[crop] || STAGES.wheat;
  const t = String(text || '');
  const alias = { 三叶: 'leaf3', 三片叶: 'leaf3', 分蘖: 'tiller', 出苗: 'emerge', 拔节: 'joint', 返青: 'green', 越冬: 'winter', 抽穗: 'head', 灌浆: 'fill', 成熟: 'mature', 完熟: 'mature', 乳熟: 'milk', 喇叭口: 'trumpet', 抽雄: 'tassel', 吐丝: 'silk' };
  const k = Object.keys(alias).find(a => t.indexOf(a) >= 0);
  if (k) { const key = alias[k]; if (list.some(s => s.key === key)) return key; }
  const byName = list.find(s => t.indexOf(s.name.replace('期', '')) >= 0);
  return byName ? byName.key : '';
}

module.exports = { CROP_GDD, STAGES, dayGdd, stagesOf, actual, current, calibrate, projectDate, stageByName };
