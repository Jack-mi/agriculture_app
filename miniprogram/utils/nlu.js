// 跟参谋说 · 本地语义解析基础件（离线兜底，纯函数）
// 中文数字 / 日期 / 地块 / 农事 / 金额 / 农资 / 机械
const U = require('./util.js');

// ---------- 中文数字 ----------
const DIG = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 俩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const UNIT = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
function cn2num(s) {
  if (s === undefined || s === null) return NaN;
  s = String(s).trim().replace(/[，,]/g, '');
  if (!s) return NaN;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const m = s.match(/^(\d+(?:\.\d+)?)(万|千)$/);
  if (m) return parseFloat(m[1]) * UNIT[m[2]];
  if (s === '半') return 0.5;
  let total = 0, sec = 0, num = 0, seen = false, lastUnit = 0, afterUnit = false, scale = 0;
  for (const ch of s) {
    if (ch === '零' || ch === '〇') { afterUnit = false; scale = 0; seen = true; continue; }
    if (DIG[ch] !== undefined) { num = DIG[ch]; seen = true; scale = afterUnit ? lastUnit : 0; afterUnit = false; }
    else if (ch === '万') { total += (sec + num) * 10000; sec = 0; num = 0; lastUnit = 10000; afterUnit = true; scale = 0; }
    else if (UNIT[ch]) { sec += (num || 1) * UNIT[ch]; num = 0; seen = true; lastUnit = UNIT[ch]; afterUnit = true; scale = 0; }
    else if (ch === '半') { num += 0.5; seen = true; }
    else return NaN;
  }
  // "一千二" = 1200、"两万五" = 25000、"三百五" = 350：紧跟单位的末位数按该单位的十分之一；"一千零二" = 1002
  if (num && scale >= 100) num = num * scale / 10;
  return total + sec + num;
}
// 句中第一个数（阿拉伯或中文）
const NUM_RE = /(\d+(?:\.\d+)?|[零〇一二两俩三四五六七八九十百千万半]+)/;
function firstNum(s) { const m = String(s || '').match(NUM_RE); return m ? cn2num(m[1]) : NaN; }

// ---------- 日期 ----------
const WEEK = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0, 七: 0 };
// 返回 YYYY-MM-DD 或 ''；base 为参照日（默认今天）
function parseDate(text, base) {
  const t = String(text || '');
  base = base || U.today();
  const plus = n => U.addDays(base, n);
  if (/大后天/.test(t)) return plus(3);
  if (/后天/.test(t)) return plus(2);
  if (/明天|明儿|明早|明个/.test(t)) return plus(1);
  if (/今天|今儿|今早|今个|刚才|刚刚/.test(t)) return base;
  if (/昨天|昨儿/.test(t)) return plus(-1);
  if (/前天/.test(t)) return plus(-2);
  let m = t.match(/(\d{1,2}|[一二三四五六七八九十]{1,3})月(\d{1,2}|[一二三四五六七八九十]{1,3})(日|号)?/);
  if (m) {
    const y = +base.slice(0, 4), mo = cn2num(m[1]), d = cn2num(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      let s = y + '-' + U.pad(mo) + '-' + U.pad(d);
      if (s < U.addDays(base, -60)) s = (y + 1) + '-' + U.pad(mo) + '-' + U.pad(d);
      return s;
    }
  }
  m = t.match(/(\d{1,2}|[一二三四五六七八九十]{1,3})(号|日)(?!子)/);
  if (m) {
    const d = cn2num(m[1]);
    if (d >= 1 && d <= 31) {
      let y = +base.slice(0, 4), mo = +base.slice(5, 7);
      let s = y + '-' + U.pad(mo) + '-' + U.pad(d);
      if (s < base) { mo++; if (mo > 12) { mo = 1; y++; } s = y + '-' + U.pad(mo) + '-' + U.pad(d); }
      return s;
    }
  }
  m = t.match(/(下下|下个?)(周|星期|礼拜)([一二三四五六日天])?/);
  if (m) {
    const wk = m[1] === '下下' ? 14 : 7;
    const dow = U.parse(base).getDay();
    const target = m[3] ? WEEK[m[3]] : 1;
    const toMon = (8 - (dow || 7)) % 7 || 7; // 到下周一
    const monday = U.addDays(base, toMon + (wk - 7));
    return U.addDays(monday, ((target || 7) - 1));
  }
  m = t.match(/(这|本)?(周|星期|礼拜)([一二三四五六日天])/);
  if (m) {
    const dow = U.parse(base).getDay(), target = WEEK[m[3]];
    let n = (target - dow + 7) % 7;
    return plus(n);
  }
  m = t.match(/(\d+|[一二两三四五六七八九十]+)\s*(天|日)(以?后|之后)/) || t.match(/过\s*(\d+|[一二两三四五六七八九十]+)\s*(天|日)/);
  if (m) { const n = cn2num(m[1]); if (n > 0 && n < 200) return plus(n); }
  if (/下周|下个星期|下礼拜/.test(t)) return plus(7);
  if (/月底/.test(t)) { const d = U.parse(base); return U.fmtDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
  return '';
}
// "往后推 3 天 / 推一周 / 提前两天"：返回相对天数或 NaN
function parseShift(text) {
  const t = String(text || '');
  let m = t.match(/(推|延|晚|往后|挪)[^0-9一二两三四五六七八九十]{0,3}(\d+|[一二两三四五六七八九十]+)\s*(天|日)/);
  if (m) return cn2num(m[2]);
  m = t.match(/(推|延|晚|往后|挪).{0,3}(一|1)?\s*(周|星期|礼拜)/);
  if (m) return 7;
  m = t.match(/提前\s*(\d+|[一二两三四五六七八九十]+)\s*(天|日)/);
  if (m) return -cn2num(m[1]);
  if (/往后推|推几天|晚几天|推后/.test(t)) return 3;
  return NaN;
}

// ---------- 地块 ----------
// plots: [{id,name}]；返回命中的 plot id 列表
function matchPlots(text, plots) {
  const t = String(text || '');
  if (/(两|几|所有|全部|每)块(地)?都|都(打|施|浇|收|种|飞)|全都/.test(t)) return plots.map(p => p.id);
  const hit = plots.filter(p => p.name && t.indexOf(p.name) >= 0);
  if (hit.length) return hit.map(p => p.id);
  // 简称：去掉"地/块/田"后的前两字
  const short = plots.filter(p => { const k = (p.name || '').replace(/[地块田]/g, ''); return k.length >= 2 && t.indexOf(k.slice(0, 2)) >= 0; });
  return short.map(p => p.id);
}

// ---------- 农事类型 ----------
const OP_WORDS = [
  ['打药', /打药|喷药|打了?一?遍药|飞防|防治|打.{0,4}(虫|病)/],
  ['机械作业', /飞防|无人机|机收|旋耕|深翻|深松|犁地|拖拉机|机械/],
  ['施肥', /施肥|追肥|撒肥|上肥|底肥|撒.{0,3}(尿素|复合肥|二铵)/],
  ['浇水', /浇水|浇了|灌溉|浇地|浇越冬水|浇透/],
  ['除草', /除草|打草|锄草|化除|封闭/],
  ['播种', /播种|播了|种上|下种|补种/],
  ['收获', /收获|收割|收了|收完|机收|抢收/],
  ['巡田', /巡田|查苗|看了看|转了一圈|去地里看|巡了/]
];
function matchOps(text) {
  const t = String(text || '');
  return OP_WORDS.filter(([, re]) => re.test(t)).map(([n]) => n);
}

// ---------- 金额 ----------
// 返回 { mode:'perMu'|'perDay'|'fixed', unitPrice, mu, people, amount } 或 null
function parseMoney(text) {
  const t = String(text || '').replace(/，/g, ',');
  const N = '(\\d+(?:\\.\\d+)?|[零一二两三四五六七八九十百千万半]+)';
  let m = t.match(new RegExp('(一|每|1)亩(地)?[^\\d零一二两三四五六七八九十百千万]{0,3}' + N + '\\s*(块|元|块钱)?'))
    || t.match(new RegExp(N + '\\s*(块|元)(钱)?\\s*(一|每|/)亩'));
  if (m) {
    const v = cn2num(m[3] !== undefined && /亩/.test(m[0].slice(0, 3)) ? m[3] : m[1]);
    if (v > 0) {
      const mu = t.match(new RegExp(N + '\\s*亩(?!地?[^\\d]{0,3}(块|元))'));
      const muV = mu && !/^(一|每|1)$/.test(mu[1]) ? cn2num(mu[1]) : NaN;
      return { mode: 'perMu', unitPrice: v, mu: muV > 0 ? muV : NaN };
    }
  }
  m = t.match(new RegExp('(雇了?|叫了?|找了?)\\s*' + N + '\\s*(个)?人')) ;
  const pm = t.match(new RegExp('(一人|每人|一个人|一天)\\s*' + N + '\\s*(块|元)?'));
  if (m && pm) return { mode: 'perDay', people: cn2num(m[2]), unitPrice: cn2num(pm[2]) };
  m = t.match(new RegExp('(花了|一共|总共|共|给了|付了|掏了|用了)\\s*' + N + '\\s*(块|元|块钱)?'))
    || t.match(new RegExp(N + '\\s*(块钱|元钱|块|元)'));
  if (m) {
    const raw = m[2] !== undefined && /花了|一共|总共|共|给了|付了|掏了|用了/.test(m[1]) ? m[2] : m[1];
    const v = cn2num(raw);
    if (v > 0) return { mode: 'fixed', amount: v };
  }
  return null;
}

// ---------- 农资 / 机械 ----------
const FERT = ['尿素', '复合肥', '二铵', '磷酸二铵', '硫酸钾', '有机肥', '磷酸二氢钾', '碳铵'];
function parseMaterials(text, pesticideNames) {
  const t = String(text || '');
  const out = [];
  (pesticideNames || []).forEach(n => { if (t.indexOf(n) >= 0) out.push({ type: '农药', name: n }); });
  FERT.forEach(n => { if (t.indexOf(n) >= 0 && !out.some(x => x.name.indexOf(n) >= 0)) out.push({ type: '化肥', name: n }); });
  const rate = t.match(/(一|每|1)亩\s*(\d+(?:\.\d+)?|[一二两三四五六七八九十百]+)\s*(克|g|毫升|ml|斤|公斤|袋)/i)
    || t.match(/(\d+(?:\.\d+)?|[一二两三四五六七八九十百]+)\s*(克|g|毫升|ml|斤|公斤)\s*(一|每|\/)亩/i);
  if (rate && out.length) {
    const v = cn2num(rate[2] && /亩/.test(rate[0].slice(0, 2)) ? rate[2] : rate[1]);
    const u = (rate[3] && /亩/.test(rate[0].slice(0, 2)) ? rate[3] : rate[2]) || '';
    const unit = /克|g/i.test(u) ? 'g/亩' : /毫升|ml/i.test(u) ? 'ml/亩' : /公斤/.test(u) ? '公斤/亩' : '斤/亩';
    if (v > 0) { out[0].rate = v; out[0].unit = unit; }
  }
  return out;
}
function parseMachine(text) {
  const m = String(text || '').match(/([\u4e00-\u9fa5]{1,4}家的?|自家的?|自己的?)?\s*(无人机|收割机|播种机|拖拉机|旋耕机|撒肥机|喷雾机|打药机)/);
  return m ? ((m[1] || '') + m[2]).replace(/的$/, '') : '';
}
function parseArea(text) {
  const m = String(text || '').match(/(\d+(?:\.\d+)?|[一二两三四五六七八九十百]+)\s*亩(?!地?[^\d]{0,3}(块|元))/);
  if (!m || /^(一|每|1)$/.test(m[1])) return NaN;
  return cn2num(m[1]);
}

module.exports = { cn2num, firstNum, parseDate, parseShift, matchPlots, matchOps, parseMoney, parseMaterials, parseMachine, parseArea };
