// 生育期积温阈值 + 品种熟期系数 + 有效积温口径
// 口径：小麦 max(0, Tmean-0)；玉米 max(0, min(Tmean,30)-10)
// 注意：与 stats.weatherSeries 的「积温」（日均温直接累加）是两套口径，并存使用。
// 阈值与品种系数为通用参考值（标定中）：按本地主栽品种实测修正后改这里即可。

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

// 品种熟期系数：>1 偏晚熟（阈值整体放大），<1 偏早熟；1.0 为通用基准（标定中）
const VARIETY_FACTOR = {
  wheat: { 济麦22: 1.0, 济麦44: 1.0, 烟农1212: 1.02, 山农29: 0.98, 鲁原502: 1.0, 青农2号: 1.0 },
  corn: { 登海605: 1.0, 郑单958: 0.98, 先玉335: 0.96, 京科968: 1.02, 裕丰303: 1.0, 迪卡517: 0.97 }
};

module.exports = { CROP_GDD, STAGES, VARIETY_FACTOR };
