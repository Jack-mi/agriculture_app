// 谷雨记 · 业务常量
// 作物配置：一期只开放小麦 / 玉米；新增作物（如花生）只需在此追加一项并置 enabled: true
const CROPS = [
  { key: 'wheat', name: '小麦', short: '麦', cls: 'wheat', enabled: true, hint: '冬小麦 · 秋播夏收，跨年' },
  { key: 'corn', name: '玉米', short: '玉', cls: 'corn', enabled: true, hint: '夏玉米 · 夏播秋收' },
  { key: 'peanut', name: '花生', short: '花', cls: 'other', enabled: false, hint: '后续开放' }
];

// 记账 5 类（PRD 5.1）
const COST_CATS = [
  { key: 'agri', name: '农资投入', color: '#2E5B34', subs: ['种子', '农药', '化肥', '其他'] },
  { key: 'mach', name: '机械作业', color: '#C98B1E', subs: ['播种', '飞防', '收获', '运输', '其他'] },
  { key: 'trans', name: '运输成本', color: '#2F6F9F', subs: ['拉粮', '运输', '其他'] },
  { key: 'labor', name: '雇工成本', color: '#C4532B', subs: ['按天用工'] },
  { key: 'asset', name: '固定资产', color: '#6B5B95', subs: ['购买机械', '土地流转', '其他'] }
];

// 每日田间操作（PRD 5.2-1），作业机械信息写在文字里
const OPS = ['施肥', '打药', '浇水', '机械作业', '除草', '巡田', '其他'];

// 墒情快捷词（仍以文字留存）
const MOISTURE = ['干旱', '偏干', '适宜', '偏湿', '积水'];

function cropOf(key) { return CROPS.find(c => c.key === key) || CROPS[0]; }
function catOf(key) { return COST_CATS.find(c => c.key === key) || COST_CATS[0]; }

module.exports = { CROPS, COST_CATS, OPS, MOISTURE, cropOf, catOf };
