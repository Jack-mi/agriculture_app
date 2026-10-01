// 限用 / 禁用 / 高风险药剂：参谋不推荐，农户记录时弹提醒
const BLOCKED = [
  { name: '百草枯', reason: '全国已禁用，不得购买使用' },
  { name: '2,4-D 丁酯', reason: '挥发飘移，易伤周边棉花、花生、果树等阔叶作物，多地区已限用' },
  { name: '甲磺隆', reason: '残留期长，易伤后茬阔叶作物，多地限制使用' }
];

module.exports = BLOCKED;
