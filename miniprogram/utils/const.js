// 田祖记 · 业务常量
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

// 整地情况的初始快捷项（用户可以自己加、自己删，存 tags.tillage）
const DEFAULT_TILLAGE = ['旋耕', '深翻', '深松', '免耕', '秸秆还田'];

// 记账 5 类（PRD 5.1）
const COST_CATS = [
  { key: 'agri', name: '农资投入', color: '#2E5B34', subs: ['种子', '农药', '化肥', '其他'] },
  { key: 'mach', name: '机械作业', color: '#C98B1E', subs: ['播种', '飞防', '收获', '运输', '其他'] },
  { key: 'trans', name: '运输成本', color: '#2F6F9F', subs: ['拉粮', '运输', '其他'] },
  { key: 'labor', name: '雇工成本', color: '#C4532B', subs: ['按天用工'] },
  { key: 'asset', name: '固定资产', color: '#6B5B95', subs: ['购买机械', '土地流转', '其他'] }
];

// 收入类型（记账 P0 收入侧）：口径是「钱进来了」，与支出 5 类并列，不是它的子类
// mode = 该类型的默认计算方式，记一笔选到它时自动切换
// icon 一律用白色线性图标 + 绿底（复用 assets/icons/*_w.svg，不新增资源）
const INCOME_CATS = [
  { key: 'grain', name: '卖粮', color: '#2E5B34', icon: 'wheat', mode: 'perJin' },
  { key: 'subsidy', name: '补贴', color: '#2E5B34', icon: 'shield', mode: 'fixed' },
  { key: 'rent', name: '土地租金', color: '#2E5B34', icon: 'land', mode: 'fixed' },
  { key: 'service', name: '农机服务', color: '#2E5B34', icon: 'tractor', mode: 'fixed' },
  { key: 'insure', name: '保险赔付', color: '#2E5B34', icon: 'note', mode: 'fixed' },
  { key: 'inother', name: '其他', color: '#2E5B34', icon: 'dots', mode: 'fixed' }
];
// 收支与欠款的语义色：全部复用现有设计系统的色值，不引入新色相
const MONEY_COLORS = {
  in: '#2E5B34', inBg: '#E4ECDD',
  out: '#C4532B', outBg: '#F8E1D6',
  debt: '#6B5B95', debtBg: '#EDE9F4'
};
const INCOME_COLOR = MONEY_COLORS.in;
// 收入侧结款状态
const SETTLE_STATES = [
  { key: 'paid', name: '已结款' },
  { key: 'due', name: '未结款' }
];
// 资金账户（钱在哪个口袋）：只做本地口径，挂在 tags 单文档，不新增云端集合
// init = 期初余额；余额 = init + Σ收入 − Σ支出（未指定账户的账不计入任何账户）
const DEFAULT_ACCOUNTS = [
  { key: 'cash', name: '现金', init: 0 },
  { key: 'wechat', name: '微信', init: 0 },
  { key: 'alipay', name: '支付宝', init: 0 },
  { key: 'bank', name: '银行卡', init: 0 },
  { key: 'other', name: '其他', init: 0 }
];
// 账户默认表版本：升到 2 时给老库补上「支付宝」（只补缺的，用户自己加/改的都不动）
const ACCOUNTS_VER = 2;
// 欠款约定的相对标记（不写死日期）
const DUE_TAGS = ['不约定', '收粮后', '卖粮后', '年底'];

// 每日田间操作（PRD 5.2-1）—— 仅作"默认记事类型"，用户可在「类型管理」里增删改
const OPS = ['播种', '施肥', '打药', '浇水', '机械作业', '除草', '巡田', '病虫害观察', '收获', '其他'];
// costCat/costSub：该类型"保存并记花费"时默认带入的记账类别
// fields：选中该类型后，记事页"才出现"的填写项（上下对应）；matType：农资用量默认品类
const DEFAULT_LOG_TAGS = [
  { name: '播种', color: '#B0882A', costCat: 'mach', costSub: '播种', fields: ['mat', 'machine', 'area'], matType: '种子' },
  { name: '施肥', color: '#2E5B34', costCat: 'agri', costSub: '化肥', fields: ['mat', 'machine', 'area'], matType: '化肥' },
  { name: '打药', color: '#6B8E23', costCat: 'agri', costSub: '农药', fields: ['pest', 'mat', 'machine', 'area'], matType: '农药' },
  { name: '浇水', color: '#2F6F9F', costCat: 'labor', costSub: '', fields: ['area', 'moisture'], matType: '' },
  { name: '机械作业', color: '#C98B1E', costCat: 'mach', costSub: '', fields: ['machine', 'area'], matType: '' },
  { name: '除草', color: '#8A6D3B', costCat: 'labor', costSub: '', fields: ['mat', 'area'], matType: '农药' },
  { name: '巡田', color: '#5E6656', costCat: '', costSub: '', fields: ['growth', 'pest', 'moisture'], matType: '' },
  { name: '病虫害观察', color: '#B0476E', costCat: '', costSub: '', fields: ['pest', 'growth'], matType: '' },
  { name: '收获', color: '#C4532B', costCat: 'mach', costSub: '收获', fields: ['machine', 'area'], matType: '' },
  { name: '其他', color: '#9A8F7A', costCat: '', costSub: '', fields: [], matType: '' }
];
// 记事可选填写项（类型管理里可给自定义类型勾选）
const LOG_FIELDS = [
  { key: 'mat', name: '农资用量' },
  { key: 'machine', name: '机械 / 机手' },
  { key: 'area', name: '完成面积' },
  { key: 'growth', name: '作物长势' },
  { key: 'pest', name: '病虫害' },
  { key: 'moisture', name: '土壤墒情' }
];
// 按记事类型定制的提示语（未命中用通用提示）
const LOG_FIELD_PH = {
  machine: { 播种: '如：汤日刚的高精度播种机', 打药: '如：老张家无人机', 施肥: '如：自家拖拉机撒肥', 收获: '如：老王家的收割机', _: '如：谁家的什么机械' },
  pest: { 打药: '防治什么，如：玉米螟、蚜虫', _: '如：地头发现蚜虫，零星发生' },
  growth: { _: '如：开始拔节，苗齐苗壮' },
  moisture: { 浇水: '浇后墒情，如：浇透、表层湿', _: '如：表层干，10公分下湿润' }
};
// 农资品类默认单位
const MATERIAL_UNIT_DEFAULT = { 种子: '斤/亩', 化肥: '斤/亩', 农药: 'ml/亩', 其他: '斤/亩' };
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
const INCOME_CAT_ICONS = {};
INCOME_CATS.forEach(c => { INCOME_CAT_ICONS[c.key] = c.icon; });
function isIncomeCat(key) { return !!INCOME_CAT_ICONS[key]; }
function iconOf(sub, cat, tone) {
  const k = SUB_ICONS[sub] || INCOME_CAT_ICONS[cat] || CAT_ICONS[cat] || 'dots';
  // 收入没有专属色卡：未选中用灰图标（*_sub），选中传 tone='w' 配绿底白图标
  // —— 与记一笔现有「未选中浅底彩图标 / 选中实底白图标」的用法一致
  const t = tone || (isIncomeCat(cat) ? 'sub' : (cat || 'sub'));
  return '/assets/icons/' + k + '_' + t + '.svg';
}

// 记账计算方式：固定金额 / 按亩（单价×亩数）/ 按人天（人数×日工价）
const CALC_MODES = [
  { key: 'fixed', name: '直接填' },
  { key: 'perMu', name: '按亩计' },
  { key: 'perDay', name: '按人天' }
];
// 收入计算方式：卖粮按斤×价 / 转租按亩×价 / 其余直接填
const INCOME_CALC_MODES = [
  { key: 'fixed', name: '直接填' },
  { key: 'perJin', name: '按斤×价' },
  { key: 'perMuPrice', name: '按亩×价' }
];
function modesFor(dir) { return dir === 'in' ? INCOME_CALC_MODES : CALC_MODES; }
// 收入类型名 → 类型 key（用户自定义的归到「其他」，不新增 key）
function incomeKeyOf(name) { const c = INCOME_CATS.find(x => x.name === name); return c ? c.key : 'inother'; }
function catsFor(dir) { return dir === 'in' ? INCOME_CATS : COST_CATS; }
// 分摊方式
const SPLIT_MODES = [
  { key: 'area', name: '按亩均摊' },
  { key: 'even', name: '平均分' },
  { key: 'manual', name: '手动填' }
];

function cropOf(key) { return CROPS.find(c => c.key === key) || CROPS[0]; }
function catOf(key) { return COST_CATS.find(c => c.key === key) || INCOME_CATS.find(c => c.key === key) || COST_CATS[0]; }

module.exports = { LOG_FIELDS, LOG_FIELD_PH, MATERIAL_UNIT_DEFAULT, VARIETIES, DEFAULT_TILLAGE, SUB_ICONS, CAT_ICONS, INCOME_CAT_ICONS, iconOf, CALC_MODES, INCOME_CALC_MODES, modesFor, catsFor, incomeKeyOf, SPLIT_MODES, CROPS, COST_CATS, INCOME_CATS, INCOME_COLOR, MONEY_COLORS, SETTLE_STATES, DUE_TAGS, DEFAULT_ACCOUNTS, ACCOUNTS_VER, isIncomeCat, OPS, DEFAULT_LOG_TAGS, TAG_COLORS, MOISTURE, MATERIAL_TYPES, MATERIAL_UNITS, cropOf, catOf };
