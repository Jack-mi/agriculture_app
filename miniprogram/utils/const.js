// 谷雨记 · 业务常量
// 作物配置：一期只开放小麦 / 玉米；新增作物（如花生）只需在此追加一项并置 enabled: true
const CROPS = [
  { key: 'wheat', name: '小麦', short: '麦', cls: 'wheat', enabled: true, hint: '冬小麦 · 秋播夏收，跨年', icon: '/assets/crops/wheat.svg' },
  { key: 'corn', name: '玉米', short: '玉', cls: 'corn', enabled: true, hint: '夏玉米 · 夏播秋收', icon: '/assets/crops/corn.svg' },
  { key: 'peanut', name: '花生', short: '花', cls: 'other', enabled: false, hint: '后续开放', icon: '/assets/crops/peanut.svg' }
];

// 作物二级类目：品种（选填）。以下仅为快捷选项（胶东常见），用户可自由输入任意品种名
const VARIETIES = {
  wheat: ['济麦22', '济麦44', '烟农1212', '山农29', '鲁原502', '青农2号'],
  corn: ['登海605', '郑单958', '先玉335', '京科968', '裕丰303', '迪卡517'],
  peanut: ['花育25', '山花9号']
};

// 记账 5 类（PRD 5.1）
const COST_CATS = [
  { key: 'agri', name: '农资投入', color: '#2E5B34', subs: ['种子', '农药', '化肥', '其他'] },
  { key: 'mach', name: '机械作业', color: '#C98B1E', subs: ['播种', '飞防', '收获', '运输', '其他'] },
  { key: 'trans', name: '运输成本', color: '#2F6F9F', subs: ['拉粮', '运输', '其他'] },
  { key: 'labor', name: '雇工成本', color: '#C4532B', subs: ['按天用工'] },
  { key: 'asset', name: '固定资产', color: '#6B5B95', subs: ['购买机械', '土地流转', '其他'] }
];

// 每日田间操作（PRD 5.2-1）—— 仅作"默认记事类型"，用户可在「类型管理」里增删改
const OPS = ['播种', '施肥', '打药', '浇水', '机械作业', '除草', '巡田', '病虫害观察', '收获', '其他'];
// costCat/costSub：该类型"保存并记花费"时默认带入的记账类别
const DEFAULT_LOG_TAGS = [
  { name: '播种', color: '#B0882A', costCat: 'mach', costSub: '播种' },
  { name: '施肥', color: '#2E5B34', costCat: 'agri', costSub: '化肥' },
  { name: '打药', color: '#6B8E23', costCat: 'agri', costSub: '农药' },
  { name: '浇水', color: '#2F6F9F', costCat: 'labor', costSub: '' },
  { name: '机械作业', color: '#C98B1E', costCat: 'mach', costSub: '' },
  { name: '除草', color: '#8A6D3B', costCat: 'labor', costSub: '' },
  { name: '巡田', color: '#5E6656', costCat: '', costSub: '' },
  { name: '病虫害观察', color: '#B0476E', costCat: '', costSub: '' },
  { name: '收获', color: '#C4532B', costCat: 'mach', costSub: '收获' },
  { name: '其他', color: '#9A8F7A', costCat: '', costSub: '' }
];
// 自定义类型可选颜色
const TAG_COLORS = ['#2E5B34', '#6B8E23', '#2F6F9F', '#C98B1E', '#C4532B', '#6B5B95', '#8A6D3B', '#B0476E', '#5E6656'];

// 墒情快捷词（仍以文字留存）
const MOISTURE = ['干旱', '偏干', '适宜', '偏湿', '积水'];

// 农资使用明细：类型与单位
const MATERIAL_TYPES = ['种子', '农药', '化肥', '其他'];
const MATERIAL_UNITS = ['斤/亩', '公斤/亩', '株/亩', 'ml/亩', 'g/亩'];

// 细分类型 → 图标（assets/icons/{icon}_{color}.svg；color = 大类 key / w(白) / sub(灰)）
// 用户自定义的类型未命中时用大类默认图标
const SUB_ICONS = {
  种子: 'seed', 农药: 'spray', 化肥: 'flask', 有机肥: 'leaf', 叶面肥: 'leaf',
  播种: 'tractor', 飞防: 'drone', 收获: 'wheat', 运输: 'truck', 拉粮: 'truck',
  按天用工: 'users', 土地流转: 'land', 购买机械: 'gear', 其他: 'dots'
};
const CAT_ICONS = { agri: 'seed', mach: 'tractor', trans: 'truck', labor: 'users', asset: 'land' };
function iconOf(sub, cat, tone) {
  const k = SUB_ICONS[sub] || CAT_ICONS[cat] || 'dots';
  return '/assets/icons/' + k + '_' + (tone || cat || 'sub') + '.svg';
}

// 记账计算方式：固定金额 / 按亩（单价×亩数）/ 按人天（人数×日工价）
const CALC_MODES = [
  { key: 'fixed', name: '直接填' },
  { key: 'perMu', name: '按亩计' },
  { key: 'perDay', name: '按人天' }
];
// 分摊方式
const SPLIT_MODES = [
  { key: 'area', name: '按亩均摊' },
  { key: 'even', name: '平均分' },
  { key: 'manual', name: '手动填' }
];

function cropOf(key) { return CROPS.find(c => c.key === key) || CROPS[0]; }
function catOf(key) { return COST_CATS.find(c => c.key === key) || COST_CATS[0]; }

module.exports = { VARIETIES, SUB_ICONS, CAT_ICONS, iconOf, CALC_MODES, SPLIT_MODES, CROPS, COST_CATS, OPS, DEFAULT_LOG_TAGS, TAG_COLORS, MOISTURE, MATERIAL_TYPES, MATERIAL_UNITS, cropOf, catOf };
