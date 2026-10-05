// 日期与数字工具（全部使用本地时区的 YYYY-MM-DD 字符串，避免跨年/时区误差）
function pad(n) { return n < 10 ? '0' + n : '' + n; }

function fmtDate(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function today() { return fmtDate(new Date()); }

function parse(s) {
  const p = s.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}
function addDays(s, n) {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}
// b - a 的天数
function diffDays(a, b) {
  return Math.round((parse(b) - parse(a)) / 86400000);
}
// [start, end] 闭区间的所有日期
function range(start, end) {
  const out = [];
  if (!start || !end || start > end) return out;
  let cur = start;
  while (cur <= end) { out.push(cur); cur = addDays(cur, 1); }
  return out;
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
function cnDate(s, withYear) {
  const d = parse(s);
  const base = (d.getMonth() + 1) + '月' + d.getDate() + '日';
  return withYear ? d.getFullYear() + '年' + base : base;
}
function weekday(s) { return '周' + WEEK[parse(s).getDay()]; }
// 时间戳 → '10-05 14:22'（留痕用）
function dt(ts) {
  const d = new Date(+ts || Date.now());
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function money(n) {
  n = Math.round((+n || 0) * 100) / 100;
  const s = n.toFixed(n % 1 === 0 ? 0 : 2);
  // 千分位可在「我的 → 记账键盘」里关掉；关了更省眼，但复制给别人看时没那么清楚
  let sep = true;
  try { sep = require('./pref.js').all().thousands !== false; } catch (e) { sep = true; }
  return sep ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : s;
}
function round1(n) { return Math.round((+n || 0) * 10) / 10; }

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function toast(title, icon) { wx.showToast({ title, icon: icon || 'none', duration: 1600 }); }

module.exports = { pad, fmtDate, today, parse, addDays, diffDays, range, cnDate, weekday, dt, money, round1, uid, toast };
