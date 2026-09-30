// 统计：成本汇总、积温、降雨
const U = require('./util.js');
const store = require('./store.js');
const C = require('./const.js');

// 成本：按 5 类汇总 + 合计（固定资产计入当季总成本）；金额按本季分摊口径
function costSummary(seasonId) {
  const list = store.costs.bySeason(seasonId);
  const byCat = {};
  C.COST_CATS.forEach(c => { byCat[c.key] = { key: c.key, name: c.name, color: c.color, total: 0, count: 0, subs: {} }; });
  let total = 0;
  list.forEach(x => {
    const amt = store.costs.amountFor(x, seasonId);
    if (!amt) return;
    const b = byCat[x.cat] || byCat.agri;
    b.total += amt; b.count += 1;
    const sub = x.sub || '其他';
    b.subs[sub] = (b.subs[sub] || 0) + amt;
    total += amt;
  });
  const cats = C.COST_CATS.map(c => {
    const b = byCat[c.key];
    return Object.assign(b, {
      totalText: U.money(b.total),
      pct: total ? Math.round(b.total / total * 1000) / 10 : 0,
      subList: Object.keys(b.subs).map(k => ({ name: k, amount: U.money(b.subs[k]) }))
    });
  });
  return { total, totalText: U.money(total), cats, count: list.length };
}

// 气象：逐日（当日值 + 累计）；积温 = 逐日平均气温累计总和（PRD 定义）；风力取当日最大值，不累计
function weatherSeries(season) {
  const end = store.seasons.endDate(season);
  const today = U.today();
  const days = U.range(season.sowDate, end > today ? today : end);
  const w = store.weather.ofPlot(season.plotId);
  let gdd = 0, gdd0 = 0, rain = 0, known = 0, manual = 0, maxWind = null;
  const rows = days.map(d => {
    const v = w[d];
    if (v) {
      gdd += v.t; gdd0 += Math.max(0, v.t); rain += v.p; known++;
      if (v.src === 'manual') manual++;
      if (v.wind !== undefined && v.wind !== null && v.wind !== '') {
        if (maxWind === null || +v.wind > maxWind) maxWind = +v.wind;
      }
    }
    return {
      date: d, has: !!v,
      t: v ? U.round1(v.t) : null, p: v ? U.round1(v.p) : null,
      wind: v && v.wind !== undefined && v.wind !== null && v.wind !== '' ? U.round1(v.wind) : null,
      src: v ? v.src : '',
      gdd: U.round1(gdd), rain: U.round1(rain)
    };
  });
  return {
    rows, days: days.length, known, manual,
    gdd: U.round1(gdd), gdd0: U.round1(gdd0), rain: U.round1(rain),
    maxWind: maxWind === null ? null : U.round1(maxWind),
    missing: days.length - known
  };
}

// 农事日志日历：播种日 → 收获日/今天，逐日底卡（倒序由页面处理）
// 每天：日期、第几天、天气、当天日志列表、是否缺记
function logCalendar(season) {
  const end = store.seasons.endDate(season);
  const today = U.today();
  const days = U.range(season.sowDate, end > today ? today : end);
  const w = store.weather.ofPlot(season.plotId);
  const byDate = {};
  store.logs.bySeason(season.id).forEach(l => {
    (byDate[l.date] = byDate[l.date] || []).push(l);
  });
  return days.map(d => ({
    date: d,
    dayN: U.diffDays(season.sowDate, d) + 1,
    weather: w[d] || null,
    logs: byDate[d] || [],
    empty: !(byDate[d] || []).length
  }));
}

// 账本流水按日分组（本季分摊口径），倒序
// filter(c) 可选；返回 [{ date, dayN, total, items:[cost] }]
function costDays(season, filter) {
  const map = {};
  store.costs.bySeason(season.id).forEach(c => {
    if (filter && !filter(c)) return;
    const amt = store.costs.amountFor(c, season.id);
    const g = map[c.date] || (map[c.date] = { date: c.date, dayN: U.diffDays(season.sowDate, c.date) + 1, total: 0, items: [] });
    g.total += amt;
    g.items.push(c);
  });
  return Object.keys(map).sort().reverse().map(d => {
    map[d].total = Math.round(map[d].total * 100) / 100;
    return map[d];
  });
}

// 短金额：12,345 → 1.2万；用于日历格
function shortMoney(n) {
  n = +n || 0;
  if (n >= 10000) return (Math.round(n / 1000) / 10) + '万';
  return U.money(Math.round(n));
}

// 月历（周日起始，6×7 或 5×7）：ym = 'YYYY-MM'
// 每格：{ date, day, inMonth, inSeason, future, spend, spendText, rain, hasLog, unrecorded, isToday }
function costMonth(season, ym) {
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7);
  const first = U.fmtDate(new Date(y, m - 1, 1));
  const last = U.fmtDate(new Date(y, m, 0));
  const start = U.addDays(first, -new Date(y, m - 1, 1).getDay());
  const tailPad = 6 - new Date(y, m, 0).getDay();
  const end = U.addDays(last, tailPad);
  const today = U.today();
  const sEnd = store.seasons.endDate(season);
  const w = store.weather.ofPlot(season.plotId);
  const spend = {}, logged = {};
  store.costs.bySeason(season.id).forEach(c => { spend[c.date] = (spend[c.date] || 0) + store.costs.amountFor(c, season.id); });
  store.logs.bySeason(season.id).forEach(l => { logged[l.date] = true; });
  let monthTotal = 0;
  const cells = U.range(start, end).map(d => {
    const inMonth = d >= first && d <= last;
    const inSeason = d >= season.sowDate && d <= sEnd;
    const future = d > today;
    const sp = spend[d] || 0;
    if (inMonth) monthTotal += sp;
    const wd = w[d];
    return {
      date: d, day: +d.slice(8), inMonth, inSeason, future,
      spend: sp, spendText: sp ? shortMoney(sp) : '', big: sp >= 2000,
      rain: !!(wd && wd.p >= 0.1), hasLog: !!logged[d],
      unrecorded: inMonth && inSeason && !future && !sp && !logged[d],
      isToday: d === today
    };
  });
  const minYm = season.sowDate.slice(0, 7);
  const maxEnd = sEnd > today ? today : sEnd;
  return {
    ym, title: y + ' 年 ' + m + ' 月', cells,
    monthTotal: Math.round(monthTotal * 100) / 100, monthTotalText: U.money(monthTotal),
    canPrev: ym > minYm, canNext: ym < maxEnd.slice(0, 7)
  };
}
function shiftYm(ym, n) {
  const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1);
  return d.getFullYear() + '-' + U.pad(d.getMonth() + 1);
}

// 某月全部地块花费（首页汇总，按分摊金额加总 = 整笔金额，不重复计）
function monthSpend(ym) {
  let total = 0, today = 0;
  const t = U.today();
  store.db().costs.forEach(c => {
    const amt = store.costs.allocOf(c).reduce((a, x) => a + x.amount, 0);
    if (c.date.slice(0, 7) === ym) total += amt;
    if (c.date === t) today += amt;
  });
  return { total: Math.round(total * 100) / 100, today: Math.round(today * 100) / 100 };
}

// 常用账一句话描述
function tplDesc(t) {
  const split = t.split === 'area' ? ' · 按亩均摊' : t.split === 'even' ? ' · 平均分' : '';
  if (t.mode === 'perMu') return '¥' + U.money(t.unitPrice) + '/亩' + split;
  if (t.mode === 'perDay') return '¥' + U.money(t.unitPrice) + '/人·天' + (t.people ? ' × ' + t.people + '人' : '') + split;
  return '¥' + U.money(t.amount) + split;
}

// 流水行"怎么算的"说明
function calcText(c) {
  if (c.calc && c.calc.mode === 'perMu') return '¥' + U.money(c.calc.unitPrice) + '/亩 × ' + c.calc.mu + '亩';
  if (c.calc && c.calc.mode === 'perDay') return c.calc.people + '人 × ¥' + U.money(c.calc.unitPrice);
  if (!c.calc && c.people && c.unitPrice) return c.people + '人 × ¥' + U.money(c.unitPrice);
  if (c.expr) return c.expr.replace(/\+/g, '+').replace(/-/g, '−');
  return '';
}

function seasonBrief(season) {
  const plot = store.plots.get(season.plotId) || {};
  const crop = C.cropOf(season.crop);
  const end = store.seasons.endDate(season);
  const cs = costSummary(season.id);
  const ws = weatherSeries(season);
  const dayN = U.diffDays(season.sowDate, end > U.today() ? U.today() : end) + 1;
  const perMu = plot.area ? cs.total / plot.area : 0;
  return {
    id: season.id, plotId: plot.id, plotName: plot.name || '未命名地块', area: plot.area,
    crop: crop.name, variety: (season.variety || '').trim(), cropFull: crop.name + ((season.variety || '').trim() ? ' · ' + season.variety.trim() : ''), cropShort: crop.short, cropCls: crop.cls, cropIcon: crop.icon, cropKey: crop.key,
    status: season.status, sowDate: season.sowDate, sowText: U.cnDate(season.sowDate, true),
    harvestDate: season.harvestDate, dayN: dayN < 1 ? 0 : dayN,
    costTotal: cs.total, costText: cs.totalText, perMuText: perMu ? U.money(Math.round(perMu)) : '',
    gdd: ws.gdd, rain: ws.rain, logCount: store.logs.bySeason(season.id).length,
    yieldJin: season.yieldJin,
    yearLabel: seasonYearLabel(season)
  };
}

// "2026-2027 小麦" 这种跨年标签
function seasonYearLabel(s) {
  const y1 = s.sowDate.slice(0, 4);
  const y2 = (s.harvestDate || '').slice(0, 4);
  if (y2 && y2 !== y1) return y1 + '–' + y2;
  if (!y2 && s.crop === 'wheat') return y1 + '–' + (+y1 + 1);
  return y1;
}

module.exports = { costSummary, weatherSeries, seasonBrief, seasonYearLabel, logCalendar, costDays, costMonth, shiftYm, monthSpend, shortMoney, tplDesc, calcText };
