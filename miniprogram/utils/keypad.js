// 自绘数字键盘的纯逻辑（无 wx 依赖，可单测）
// 表达式只支持 + −，每段最多两位小数；上限 KEYPAD_MAX
const MAX = 9999999.99;
const OPS = ['+', '-'];

function lastSeg(expr) {
  const m = expr.match(/[^+\-]*$/);
  return m ? m[0] : '';
}

// 按键：'0'-'9' '.' '+' '-' 'del' 'clear'
function press(expr, key) {
  expr = expr || '';
  if (key === 'clear') return '';
  if (key === 'del') return expr.slice(0, -1);
  if (OPS.indexOf(key) >= 0) {
    if (!expr) return '';                        // 不能以运算符开头
    const last = expr.slice(-1);
    if (OPS.indexOf(last) >= 0) return expr.slice(0, -1) + key;  // 连按运算符 = 替换
    if (last === '.') expr = expr.slice(0, -1);
    return expr + key;
  }
  const seg = lastSeg(expr);
  if (key === '.') {
    if (seg.indexOf('.') >= 0) return expr;
    return expr + (seg === '' ? '0.' : '.');
  }
  if (!/^\d$/.test(key)) return expr;
  if (seg === '0') return expr.slice(0, -1) + key;       // 去前导 0
  const dot = seg.indexOf('.');
  if (dot >= 0 && seg.length - dot > 2) return expr;      // 两位小数
  if (dot < 0 && seg.replace(/^0+/, '').length >= 7) return expr; // 整数位 ≤ 7
  const next = expr + key;
  return evalExpr(next) > MAX ? expr : next;
}

// 求值：'320+180-5' → 495；非法/空 → 0；结果保留两位小数，负数归 0
function evalExpr(expr) {
  if (!expr) return 0;
  const clean = String(expr).replace(/[+\-.]+$/, '');
  if (!clean) return 0;
  const parts = clean.match(/[+\-]?[^+\-]+/g) || [];
  let sum = 0;
  for (const p of parts) {
    const v = parseFloat(p);
    if (isNaN(v)) return 0;
    sum += v;
  }
  sum = Math.round(sum * 100) / 100;
  return sum < 0 ? 0 : sum;
}

function hasOp(expr) { return /\d[+\-]\d/.test(expr || ''); }

// 数值 → 键盘初始表达式（编辑旧记录）
function fromNumber(n) {
  n = +n || 0;
  if (!n) return '';
  return String(Math.round(n * 100) / 100);
}

module.exports = { press, evalExpr, hasOp, fromNumber, MAX };
