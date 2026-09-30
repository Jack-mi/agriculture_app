// 农事参谋 · 生育期引擎（纯函数 + 读 store，无网络）
// 有效积温（GDD）：小麦 max(0, Tmean-0)；玉米 max(0, min(Tmean,30)-10)
// 与现有「积温」（日均温直接累加，stats.weatherSeries）口径不同，两者并存、名称区分
// 阈值为示意值，上线前需按品种标定（见 docs/农事参谋.md）
const U = require('./util.js');
const store = require('./store.js');

const CROP_GDD = {
  wheat: { base: 0, cap: 99 },
  corn: { base: 10, cap: 30 }
};

// 各阶段"进入该阶段"的累计有效积温（℃·d）
const STAGES = {
  wheat: [
    { key: 'sow', name: '播种', gdd: 0, tip: '刚播下' },
    { key: 'emerge', name: '出苗期', gdd: 120, tip: '大部分苗露出地面 2 公分' },
    { key: 'leaf3', name: '三叶期', gdd: 220, tip: '主茎第三片叶伸出一半' },
    { key: 'tiller', name: '分蘖期', gdd: 380, tip: '叶腋长出第一个分蘖' },
    { key: 'winter', name: '越冬期', gdd: 560, tip: '日均温降到 0℃ 以下，停止生长' },
    { key: 'green', name: '返青期', gdd: 700, tip: '开春新叶转绿、开始生长' },
    { key: 'joint', name: '拔节期', gdd: 950, tip: '基部第一节间伸长 1.5–2 公分' },
    { key: 'head', name: '抽穗期', gdd: 1350, tip: '麦穗从旗叶鞘里露出一半' },
    { key: 'fill', name: '灌浆期', gdd: 1550, tip: '籽粒开始长饱' },
    { key: 'mature', name: '成熟期', gdd: 2050, tip: '籽粒变硬、茎叶变黄' }
  ],
  corn: [
    { key: 'sow', name: '播种', gdd: 0, tip: '刚播下' },
    { key: 'emerge', name: '出苗期', gdd: 70, tip: '幼苗露出地面 2 公分' },
    { key: 'joint', name: '拔节期', gdd: 380, tip: '茎基部节间开始伸长' },
    { key: 'trumpet', name: '大喇叭口期', gdd: 640, tip: '上部叶片呈喇叭口状' },
    { key: 'tassel', name: '抽雄期', gdd: 820, tip: '雄穗从顶叶露出' },
    { key: 'silk', name: '吐丝期', gdd: 880, tip: '雌穗花丝吐出' },
    { key: 'fill', name: '灌浆期', gdd: 1050, tip: '籽粒开始长饱' },
    { key: 'milk', name: '乳熟期', gdd: 1250, tip: '籽粒挤出乳白浆' },
    { key: 'mature', name: '完熟期', gdd: 1480, tip: '乳线消失、籽粒基部出现黑层' }
  ]
};

// 品种熟期系数（示意）：>1 表示晚熟，阈值整体放大
const VARIETY_FACTOR = {
  wheat: { 济麦22: 1.0, 济麦44: 1.0, 烟农1212: 1.02, 山农29: 0.98, 鲁原502: 1.0, 青农2号: 1.0 },
  corn: { 登海605: 1.0, 郑单958: 0.98, 先玉335: 0.96, 京科968: 1.02, 裕丰303: 1.0, 迪卡517: 0.97 }
};

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
