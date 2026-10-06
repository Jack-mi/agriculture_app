#!/usr/bin/env node
// kb 双份拷贝守卫：miniprogram/kb（客户端本地规则/生育期用）与
// cloudfunctions/advisorAgent/kb（云端多智能体用）必须逐字节一致，只读守卫不自动同步。
// 改了一边忘了另一边时这里直接失败。canonical 不限定，改哪边都行，但必须两边一起改。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const A = path.join(ROOT, 'miniprogram/kb');
const B = path.join(ROOT, 'cloudfunctions/advisorAgent/kb');
const FILES = ['docs.js', 'blocked.js', 'pesticides.js', 'stages.js', 'index.js'];

const bad = FILES.filter(f => {
  const a = fs.readFileSync(path.join(A, f), 'utf8');
  const b = fs.readFileSync(path.join(B, f), 'utf8');
  return a !== b;
});
if (bad.length) {
  console.error('✖ kb 两份拷贝不一致：' + bad.join('、'));
  console.error('  miniprogram/kb 与 cloudfunctions/advisorAgent/kb 必须一起改');
  process.exit(1);
}
console.log('✔ kb 两份拷贝一致（' + FILES.length + ' 个文件）');
