// 农事参谋 · 农药合规校验（一期内置示意登记表）
// 上线前：接入农药登记信息库（ICAMA）月度数据，存 pesticide_reg；登记证号此处为占位
// 两层口径：参谋推荐时——未登记 / 本地限用一律不推荐；农户自己记录时——超量只提醒，不拦保存
const REG = [
  { name: '双氟磺草胺', form: '50g/L 悬浮剂', reg: 'PD2016XXXX', crops: ['wheat'], target: '阔叶杂草', rate: [5, 6], unit: 'ml/亩', times: 1 },
  { name: '氯氟吡氧乙酸', form: '200g/L 乳油', reg: 'PD2009XXXX', crops: ['wheat'], target: '阔叶杂草', rate: [50, 60], unit: 'ml/亩', times: 1 },
  { name: '吡虫啉', form: '70% 水分散粒剂', reg: 'PD2012XXXX', crops: ['wheat'], target: '蚜虫', rate: [4, 6], unit: 'g/亩', times: 2 },
  { name: '氯虫苯甲酰胺', form: '5% 悬浮剂', reg: 'PD2014XXXX', crops: ['corn'], target: '玉米螟', rate: [16, 20], unit: 'ml/亩', times: 2 },
  { name: '戊唑醇', form: '430g/L 悬浮剂', reg: 'PD2011XXXX', crops: ['wheat'], target: '赤霉病', rate: [15, 20], unit: 'ml/亩', times: 2 }
];
const BLOCK = [
  { name: '2,4-D 丁酯', reason: '挥发飘移，易伤周边棉花、花生等阔叶作物，本地区已限用' }
];

// 推荐：按作物 + 防治对象，只返回已登记的
function recommend(crop, target) {
  return REG.filter(r => r.crops.indexOf(crop) >= 0 && (!target || r.target === target));
}
function blocked(target) { return target === '阔叶杂草' ? BLOCK : []; }

// 记录校验：{ level:'ok'|'warn'|'unknown', msg }
function check(crop, name, rate, unit) {
  const n = String(name || '').trim();
  if (!n) return { level: 'unknown', msg: '' };
  const b = BLOCK.find(x => n.indexOf(x.name.replace(/\s/g, '')) >= 0 || x.name.indexOf(n) >= 0);
  if (b) return { level: 'warn', msg: b.name + '：' + b.reason };
  const r = REG.find(x => n.indexOf(x.name) >= 0 || x.name.indexOf(n) >= 0);
  if (!r) return { level: 'unknown', msg: '' };
  if (r.crops.indexOf(crop) < 0) return { level: 'warn', msg: r.name + ' 未登记用于这种作物' };
  const v = parseFloat(rate);
  if (!isNaN(v) && (!unit || unit === r.unit) && v > r.rate[1] * 1.2) {
    return { level: 'warn', msg: '超过登记用量（' + r.rate[0] + '–' + r.rate[1] + ' ' + r.unit + '），可能伤苗。确实这么用的话仍可保存' };
  }
  return { level: 'ok', msg: '在登记用量内（' + r.rate[0] + '–' + r.rate[1] + ' ' + r.unit + '）' };
}

module.exports = { REG, BLOCK, recommend, blocked, check };
