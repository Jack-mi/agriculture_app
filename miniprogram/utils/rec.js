// 周期账的「多久一次 / 哪天」口径：记一笔里「存成周期账」和周期账页共用一套文案。
// 关键约定：周 = 周几；月 = 几号；季 = 每 3 个月一次，落在哪个月 + 几号；年 = 哪个月 + 几号。
// （以前季/年只让选「几号」，锚月写死在 1 月，等于没得选——这里改成明选月份。）
const U = require('./util.js');

const FREQS = [{ k: 'week', n: '每周' }, { k: 'month', n: '每月' }, { k: 'quarter', n: '每季' }, { k: 'year', n: '每年' }];
const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6].map(d => ({ d, n: ['日', '一', '二', '三', '四', '五', '六'][d] }));
const MONTH_OPTS = [];
for (let m = 1; m <= 12; m++) MONTH_OPTS.push(m + ' 月');
const DAY_OPTS = [];
for (let d = 1; d <= 31; d++) DAY_OPTS.push(d + ' 号');

const NEED_MONTH = f => f === 'quarter' || f === 'year';

// 用户选的锚月；老数据没 month 就按起点月推算（和 store.recurring 口径一致）
function anchorMonth(r) {
  const m = +((r || {}).month);
  if (m >= 1 && m <= 12) return m;
  if (r && r.startAt) return U.parse(r.startAt).getMonth() + 1;
  return 1;
}

// 这个周期落到哪几个月（季 = 4 个，年 = 1 个）
function monthsOf(r) {
  if (!r) return [];
  if (r.freq === 'year') return [anchorMonth(r)];
  if (r.freq === 'quarter') {
    const a = anchorMonth(r);
    return [0, 1, 2, 3].map(i => ((a - 1 + i * 3) % 12) + 1).sort((x, y) => x - y);
  }
  return [];
}

// 一句话说清「多久一次」——直接回答"我到底设成了啥"
function ruleText(r) {
  if (!r) return '';
  const day = +r.day || 1;
  if (r.freq === 'week') return '每周 ' + ['日', '一', '二', '三', '四', '五', '六'][day % 7];
  if (r.freq === 'month') return '每月 ' + day + ' 号';
  if (r.freq === 'quarter') return '每 3 个月一次 · ' + monthsOf(r).join(' / ') + ' 月的 ' + day + ' 号';
  return '每年 ' + anchorMonth(r) + ' 月 ' + day + ' 号';
}

// 下次提醒：当场算给用户看，写错了立刻能发现
function nextText(r) {
  if (!r) return '';
  const store = require('./store.js');
  const d = store.recurring.nextOn(Object.assign({}, r, { enabled: true }), U.today());
  return d ? U.cnDate(d, true) + ' ' + U.weekday(d) : '';
}

// 列表里那行小字：周几 / 每月 N 号 / 每年 M 月 N 号 …
function dayText(r) {
  if (!r) return '';
  const day = +r.day || 1;
  if (r.freq === 'week') return '周' + ['日', '一', '二', '三', '四', '五', '六'][day % 7];
  if (r.freq === 'month') return '每月 ' + day + ' 号';
  return monthsOf(r).join('、') + ' 月 ' + day + ' 号';
}

module.exports = { FREQS, WEEK_DAYS, MONTH_OPTS, DAY_OPTS, NEED_MONTH, anchorMonth, monthsOf, ruleText, nextText, dayText };
