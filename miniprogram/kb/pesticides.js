// 农药登记表 · 胶东小麦 / 夏玉米常用药剂
// 来源：中国农药信息网（ICAMA）公开登记信息整理（2026 年复核）。
// 口径：rate 为常见登记用量区间，**具体产品以标签为准**；只收仍在登记有效期内的常见剂型。
// crops 用作物 key（wheat/corn）；target 与参谋任务/规则的防治对象对齐：
//   阔叶杂草 / 禾本科杂草 / 蚜虫 / 玉米螟 / 赤霉病 / 锈病 / 大斑病 / 纹枯病 / 地下害虫
const PESTICIDES = [
  // ---- 小麦田除草 ----
  { name: '双氟磺草胺', form: '50克/升悬浮剂', crops: ['wheat'], target: '阔叶杂草', rate: [5, 6], unit: 'ml/亩', times: 1 },
  { name: '氯氟吡氧乙酸', form: '200克/升乳油', crops: ['wheat'], target: '阔叶杂草', rate: [50, 60], unit: 'ml/亩', times: 1 },
  { name: '苯磺隆', form: '10%可湿性粉剂', crops: ['wheat'], target: '阔叶杂草', rate: [10, 15], unit: 'g/亩', times: 1, note: '对后茬阔叶作物有残留风险，按标签间隔期安排' },
  { name: '炔草酯', form: '15%可湿性粉剂', crops: ['wheat'], target: '禾本科杂草', rate: [20, 30], unit: 'g/亩', times: 1, note: '主防看麦娘、野燕麦' },
  { name: '甲基二磺隆', form: '30克/升可分散油悬浮剂', crops: ['wheat'], target: '禾本科杂草', rate: [20, 35], unit: 'ml/亩', times: 1, note: '主防节节麦，含安全剂；弱苗、寒潮前后不用' },
  // ---- 玉米田除草 ----
  { name: '烟嘧磺隆', form: '40克/升可分散油悬浮剂', crops: ['corn'], target: '禾本科杂草', rate: [80, 100], unit: 'ml/亩', times: 1, note: '玉米 3–5 叶期用，甜玉米糯玉米禁用' },
  { name: '硝磺草酮', form: '15%悬浮剂', crops: ['corn'], target: '阔叶杂草', rate: [100, 150], unit: 'ml/亩', times: 1 },
  { name: '莠去津', form: '38%悬浮剂', crops: ['corn'], target: '阔叶杂草', rate: [200, 300], unit: 'ml/亩', times: 1, note: '多与烟嘧磺隆复配' },
  { name: '乙草胺', form: '900克/升乳油', crops: ['corn'], target: '禾本科杂草', rate: [100, 150], unit: 'ml/亩', times: 1, note: '播后苗前封闭，需墒情好' },
  // ---- 杀虫 ----
  { name: '吡虫啉', form: '70%水分散粒剂', crops: ['wheat'], target: '蚜虫', rate: [2, 4], unit: 'g/亩', times: 2 },
  { name: '啶虫脒', form: '5%乳油', crops: ['wheat'], target: '蚜虫', rate: [24, 36], unit: 'ml/亩', times: 2 },
  { name: '高效氯氟氰菊酯', form: '2.5%水乳剂', crops: ['wheat', 'corn'], target: '蚜虫', rate: [20, 40], unit: 'ml/亩', times: 2, note: '兼治玉米螟、粘虫' },
  { name: '氯虫苯甲酰胺', form: '200克/升悬浮剂', crops: ['corn'], target: '玉米螟', rate: [5, 10], unit: 'ml/亩', times: 2, note: '大喇叭口期用最关键' },
  // ---- 杀菌 ----
  { name: '戊唑醇', form: '430克/升悬浮剂', crops: ['wheat'], target: '赤霉病', rate: [15, 20], unit: 'ml/亩', times: 2, note: '兼治锈病、白粉病' },
  { name: '氰烯菌酯', form: '25%悬浮剂', crops: ['wheat'], target: '赤霉病', rate: [100, 150], unit: 'ml/亩', times: 2 },
  { name: '吡唑醚菌酯', form: '25%悬浮剂', crops: ['wheat', 'corn'], target: '锈病', rate: [30, 40], unit: 'ml/亩', times: 2, note: '兼治玉米大斑病' },
  { name: '苯醚甲环唑', form: '10%水分散粒剂', crops: ['wheat'], target: '纹枯病', rate: [40, 60], unit: 'g/亩', times: 2 }
];

module.exports = PESTICIDES;
