// 农事参谋 · 农药合规校验（薄适配层）
// 数据在 miniprogram/kb/pesticides.js 与 blocked.js（ICAMA 公开登记整理，可插拔）。
// 两层口径：参谋推荐时——未登记 / 本地限用一律不推荐；农户自己记录时——超量只提醒，不拦保存
const { PESTICIDES: REG, BLOCKED: BLOCK } = require('../kb');

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
