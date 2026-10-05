// 统计：成本汇总、积温、降雨
const U = require('./util.js');
const store = require('./store.js');
const C = require('./const.js');

// 成本：按 5 类汇总 + 合计（固定资产计入当季总成本）；金额按本季分摊口径；只算支出（收入走 incomeSummary）
function costSummary(seasonId) {
  const list = store.costs.bySeason(seasonId).filter(x => !store.isIncome(x));
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

// 收入：按收入类型汇总（本季分摊口径）
function incomeSummary(seasonId) {
  const list = store.costs.bySeason(seasonId).filter(x => store.isIncome(x));
  const byCat = {};
  list.forEach(x => {
    const amt = store.costs.amountFor(x, seasonId);
    if (!amt) return;
    const c = C.catOf(x.cat);
    const b = byCat[x.cat] || (byCat[x.cat] = { key: x.cat, name: c.name, color: c.color, total: 0, count: 0, subs: {} });
    b.total += amt; b.count += 1;
    const sub = x.sub || c.name;
    b.subs[sub] = (b.subs[sub] || 0) + amt;
  });
  let total = 0;
  const cats = Object.keys(byCat).map(k => {
    const b = byCat[k];
    total += b.total;
    return Object.assign(b, { totalText: U.money(b.total), subList: Object.keys(b.subs).map(n => ({ name: n, amount: U.money(b.subs[n]) })) });
  });
  return { total: Math.round(total * 100) / 100, totalText: U.money(total), cats, count: list.length };
}

// 净收益：收入 − 支出（均按分摊金额）
function netOf(seasonId) {
  const inc = incomeSummary(seasonId).total;
  const exp = costSummary(seasonId).total;
  const net = Math.round((inc - exp) * 100) / 100;
  return { income: inc, expense: exp, net, incomeText: U.money(inc), expenseText: U.money(exp), netText: U.money(net), hasIncome: inc > 0 };
}

// 时间口径：'year' | 'season' | 'month' | 'all'，可叠加地块
// 流水筛选（账本页用）：f = { dir, cats[], subs[], amtMin, amtMax, from, to, onlyDebt, onlyAttach, onlyLinked, plotId, seasonId }，q = 关键词
// 纯函数，页面只负责收集条件；空条件 = 全通过
function matchesFilter(c, f, q) {
  f = f || {};
  if (f.dir && f.dir !== 'all' && store.dirOf(c) !== f.dir) return false;
  if (f.cats && f.cats.length && f.cats.indexOf(c.cat) < 0) return false;
  if (f.subs && f.subs.length && (!c.sub || f.subs.indexOf(c.sub) < 0)) return false;
  const amt = store.allocTotal(c);
  if (f.amtMin !== '' && f.amtMin !== undefined && f.amtMin !== null && amt < +f.amtMin) return false;
  if (f.amtMax !== '' && f.amtMax !== undefined && f.amtMax !== null && amt > +f.amtMax) return false;
  if (f.from && c.date < f.from) return false;
  if (f.to && c.date > f.to) return false;
  if (f.onlyDebt && !store.isDebtOpen(c)) return false;
  if (f.onlyAttach && !(c.attachments || []).length) return false;
  if (f.onlyLinked && !c.logId) return false;
  if (f.account && store.accounts.keyOf(c) !== f.account) return false;
  const allocs = store.costs.allocOf(c);
  if (f.seasonId && !allocs.some(a => a.seasonId === f.seasonId)) return false;
  if (f.plotId && !allocs.some(a => { const s = store.seasons.get(a.seasonId); return s && s.plotId === f.plotId; })) return false;
  const kw = (q || '').trim();
  if (kw) {
    const d = c.debt || {};
    const hay = [c.sub, c.note, d.party, C.catOf(c.cat).name, c.date].join(' ');
    if (hay.indexOf(kw) < 0) return false;
  }
  return true;
}

// 缺记的日子：区间内既没有账、也没有记事（连续补账页用）
function missingDays(from, to, seasonId) {
  const hasCost = {}, hasLog = {};
  store.costs.all(c => !seasonId || store.costs.allocOf(c).some(a => a.seasonId === seasonId)).forEach(c => { hasCost[c.date] = true; });
  store.db().logs.forEach(l => { if (!l.deletedAt && (!seasonId || l.seasonId === seasonId)) hasLog[l.date] = true; });
  return U.range(from, to).filter(d => !hasCost[d] && !hasLog[d]);
}

function scopeFilter(scope, opt) {
  opt = opt || {};
  const y = (opt.today || U.today()).slice(0, 4);
  const m = (opt.today || U.today()).slice(0, 7);
  const s = opt.season;
  return c => {
    if (s && !store.costs.allocOf(c).some(a => a.seasonId === s.id)) return false;
    if (opt.plotId && !store.costs.allocOf(c).some(a => { const se = store.seasons.get(a.seasonId); return se && se.plotId === opt.plotId; })) return false;
    if (scope === 'year') return c.date.slice(0, 4) === y;
    if (scope === 'month') return c.date.slice(0, 7) === m;
    if (scope === 'season') return !!(s && store.costs.amountFor(c, s.id));
    return true;
  };
}

// 收支总览（报表首屏）：净收益 + 三个农业指标
function overview(filterFn, opt) {
  opt = opt || {};
  const inc = store.costs.income(filterFn), exp = store.costs.expense(filterFn);
  const sum = list => Math.round(list.reduce((a, c) => a + store.allocTotal(c), 0) * 100) / 100;
  // 面积与产量：按命中的季去重
  const sids = {};
  inc.concat(exp).forEach(c => store.costs.allocOf(c).forEach(a => { sids[a.seasonId] = true; }));
  let area = 0, yieldJin = 0;
  Object.keys(sids).forEach(id => {
    const s = store.seasons.get(id); if (!s) return;
    const p = store.plots.get(s.plotId) || {};
    area += (+p.area || 0);
    if (!store.costs.isIncome({ dir: 'in' })) yieldJin += +s.yieldJin || 0;
  });
  const income = sum(inc), expense = sum(exp);
  return {
    income, expense, net: Math.round((income - expense) * 100) / 100,
    incomeText: U.money(income), expenseText: U.money(expense), netText: U.money(Math.round((income - expense) * 100) / 100),
    incomeCount: inc.length, expenseCount: exp.length,
    area: Math.round(area * 10) / 10, yieldJin: Math.round(yieldJin),
    perMuCost: area ? Math.round(expense / area) : 0,
    costPerJin: yieldJin ? Math.round(expense / yieldJin * 100) / 100 : 0
  };
}

// 支出结构：5 大类聚合（按可选 filterFn 限定范围）
function structureOf(filterFn) {
  const list = store.costs.expense(filterFn);
  const cats = C.COST_CATS.map(c => ({ key: c.key, name: c.name, color: c.color, total: 0, count: 0 }));
  let total = 0;
  list.forEach(c => {
    const amt = store.allocTotal(c);
    const b = cats.find(x => x.key === c.cat) || cats[0];
    b.total += amt; b.count += 1; total += amt;
  });
  cats.forEach(b => { b.total = Math.round(b.total * 100) / 100; b.totalText = U.money(b.total); b.pct = total ? Math.round(b.total / total * 1000) / 10 : 0; });
  return { total: Math.round(total * 100) / 100, totalText: U.money(total), cats };
}

// 月度趋势（近 n 个月，含收入与支出）
function monthlyTrend(n, filterFn, today) {
  const base = today || U.today();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const ym = shiftYm(base.slice(0, 7), -i);
    out.push({ ym, label: (+ym.slice(5, 7)) + '月', income: 0, expense: 0 });
  }
  const idx = {}; out.forEach((x, i) => { idx[x.ym] = i; });
  store.costs.all(filterFn).forEach(c => {
    const i = idx[c.date.slice(0, 7)];
    if (i === undefined) return;
    const amt = store.allocTotal(c);
    if (store.isIncome(c)) out[i].income += amt; else out[i].expense += amt;
  });
  let max = 1;
  out.forEach(x => { x.income = Math.round(x.income * 100) / 100; x.expense = Math.round(x.expense * 100) / 100; x.net = Math.round((x.income - x.expense) * 100) / 100; max = Math.max(max, x.income, x.expense); });
  out.forEach(x => { x.incomePct = Math.round(x.income / max * 100); x.expensePct = Math.round(x.expense / max * 100); x.incomeText = shortMoney(x.income); x.expenseText = shortMoney(x.expense); });
  return out;
}

// 按种植季（≈按作物/地块）收支
function bySeasonRows(filterFn) {
  const sids = {};
  store.costs.all(filterFn).forEach(c => store.costs.allocOf(c).forEach(a => { sids[a.seasonId] = true; }));
  return Object.keys(sids).map(id => {
    const s = store.seasons.get(id);
    const p = s ? store.plots.get(s.plotId) || {} : {};
    const n = netOf(id);
    return Object.assign({ id, plotName: p.name || '—', area: +p.area || 0, crop: s ? C.cropOf(s.crop).name : '—', yearLabel: s ? seasonYearLabel(s) : '' },
      n, { perMuNet: p.area ? Math.round(n.net / p.area) : 0, sold: n.hasIncome });
  }).sort((a, b) => b.net - a.net);
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
    const g = map[c.date] || (map[c.date] = { date: c.date, dayN: U.diffDays(season.sowDate, c.date) + 1, total: 0, income: 0, expense: 0, items: [] });
    if (store.isIncome(c)) g.income += amt;
    else { g.expense += amt; g.total += amt; }
    g.items.push(c);
  });
  return Object.keys(map).sort().reverse().map(d => {
    const g = map[d];
    g.total = Math.round(g.total * 100) / 100;
    g.income = Math.round(g.income * 100) / 100;
    g.expense = Math.round(g.expense * 100) / 100;
    g.net = Math.round((g.income - g.expense) * 100) / 100;
    g.netText = U.money(g.net);
    g.incomeText = g.income ? U.money(g.income) : '';
    g.expenseText = g.expense ? U.money(g.expense) : '';
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
// 每格：{ date, day, inMonth, inSeason, future, spend, spendText, income, incomeText, rain, hasLog, unrecorded, isToday }
// opt（可选，用于「全部地块」全局日历）：
//   entries [{date, amount, dir}] 取代按季取数；loggedDates [] 取代按季记事；
//   noSeasonLimit true 时不按播种/收获区间置灰；minYm / maxYm 覆盖可翻页范围；noWeather 不带天气点
function costMonth(season, ym, opt) {
  opt = opt || {};
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7);
  const first = U.fmtDate(new Date(y, m - 1, 1));
  const last = U.fmtDate(new Date(y, m, 0));
  const start = U.addDays(first, -new Date(y, m - 1, 1).getDay());
  const tailPad = 6 - new Date(y, m, 0).getDay();
  const end = U.addDays(last, tailPad);
  const today = U.today();
  const sEnd = opt.noSeasonLimit ? '9999-12-31' : store.seasons.endDate(season);
  const w = opt.noWeather ? {} : store.weather.ofPlot(season.plotId);
  const spend = {}, earn = {}, logged = {};
  const entries = opt.entries || store.costs.bySeason(season.id).map(c => ({ date: c.date, amount: store.costs.amountFor(c, season.id), dir: store.dirOf(c) }));
  entries.forEach(e => {
    if (e.dir === 'in') earn[e.date] = (earn[e.date] || 0) + e.amount;
    else spend[e.date] = (spend[e.date] || 0) + e.amount;
  });
  if (opt.loggedDates) opt.loggedDates.forEach(d => { logged[d] = true; });
  else store.logs.bySeason(season.id).forEach(l => { logged[l.date] = true; });
  let monthTotal = 0, monthIncome = 0;
  const cells = U.range(start, end).map(d => {
    const inMonth = d >= first && d <= last;
    const inSeason = d >= season.sowDate && d <= sEnd;
    const future = d > today;
    const sp = spend[d] || 0;
    const inc = earn[d] || 0;
    if (inMonth) monthTotal += sp;
    if (inMonth) monthIncome += inc;
    const wd = w[d];
    return {
      date: d, day: +d.slice(8), inMonth, inSeason, future,
      spend: sp, spendText: sp ? shortMoney(sp) : '', big: sp >= 2000,
      income: inc, incomeText: inc ? shortMoney(inc) : '',
      rain: !!(wd && wd.p >= 0.1), hasLog: !!logged[d],
      unrecorded: inMonth && inSeason && !future && !sp && !inc && !logged[d],
      isToday: d === today
    };
  });
  const minYm = opt.minYm || season.sowDate.slice(0, 7);
  const maxEnd = sEnd > today ? today : sEnd;
  const maxYm = opt.maxYm || maxEnd.slice(0, 7);
  monthTotal = Math.round(monthTotal * 100) / 100;
  monthIncome = Math.round(monthIncome * 100) / 100;
  const net = Math.round((monthIncome - monthTotal) * 100) / 100;
  return {
    ym, title: y + ' 年 ' + m + ' 月', cells,
    monthTotal, monthTotalText: U.money(monthTotal),
    monthIncome, monthIncomeText: U.money(monthIncome), monthNet: net, monthNetText: U.money(net),
    canPrev: ym > minYm, canNext: ym < maxYm
  };
}

// 周历：一周 7 格，结构与月历格一致（供账本/季详情「周历」视图用）
// weekStart 为周日；返回 cells 固定 7 个
function costWeek(season, weekStart, opt) {
  opt = opt || {};
  const ym = costMonth(season, weekStart.slice(0, 7), opt);
  const byDate = {}; ym.cells.forEach(c => { byDate[c.date] = c; });
  const today = U.today();
  const sEnd = store.seasons.endDate(season);
  const w = opt.noWeather ? {} : store.weather.ofPlot(season.plotId);
  const cells = U.range(weekStart, U.addDays(weekStart, 6)).map(d => {
    const c = byDate[d];
    const inSeason = opt.noSeasonLimit ? true : (d >= season.sowDate && d <= sEnd);
    if (c) return Object.assign({}, c, { inMonth: true, inSeason, future: d > today });
    const wd = w[d];
    return {
      date: d, day: +d.slice(8), inMonth: true, inSeason, future: d > today,
      spend: 0, spendText: '', big: false, income: 0, incomeText: '',
      rain: !!(wd && wd.p >= 0.1), hasLog: false, unrecorded: false, isToday: d === today
    };
  });
  // 与月历同源的 spend/earn 由 cells 带出；周小计
  let expense = 0, income = 0;
  cells.forEach(c => { expense += c.spend; income += c.income; });
  expense = Math.round(expense * 100) / 100; income = Math.round(income * 100) / 100;
  const shortMd = d => (+d.slice(5, 7)) + '/' + (+d.slice(8));
  return {
    start: weekStart, end: U.addDays(weekStart, 6), cells,
    title: shortMd(weekStart) + ' – ' + shortMd(U.addDays(weekStart, 6)),
    expense, income, net: Math.round((income - expense) * 100) / 100,
    expenseText: U.money(expense), incomeText: U.money(income), netText: U.money(income - expense)
  };
}
// 某天所在周的周日
function weekStartOf(date) { return U.addDays(date, -U.parse(date).getDay()); }
function shiftYm(ym, n) {
  const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1);
  return d.getFullYear() + '-' + U.pad(d.getMonth() + 1);
}

// 某月全部地块花费（首页汇总，按分摊金额加总 = 整笔金额，不重复计）
function monthSpend(ym) {
  let total = 0, today = 0, income = 0;
  const t = U.today();
  store.db().costs.forEach(c => {
    if (c.deletedAt) return;
    const amt = store.costs.allocOf(c).reduce((a, x) => a + x.amount, 0);
    const isIn = store.isIncome(c);
    if (c.date.slice(0, 7) === ym) { if (isIn) income += amt; else total += amt; }
    if (c.date === t && !isIn) today += amt;
  });
  total = Math.round(total * 100) / 100;
  income = Math.round(income * 100) / 100;
  return {
    total, today: Math.round(today * 100) / 100, income,
    net: Math.round((income - total) * 100) / 100,
    totalText: U.money(total), incomeText: U.money(income), netText: U.money(income - total)
  };
}

// 常用账一句话描述
function tplDesc(t) {
  const split = t.split === 'area' ? ' · 按亩均摊' : t.split === 'even' ? ' · 平均分' : '';
  if (t.mode === 'perMu') return '¥' + U.money(t.unitPrice) + '/亩' + split;
  if (t.mode === 'perJin') return '¥' + U.money(t.unitPrice) + '/斤' + split;
  if (t.mode === 'perMuPrice') return '¥' + U.money(t.unitPrice) + '/亩' + split;
  if (t.mode === 'perDay') return '¥' + U.money(t.unitPrice) + '/人·天' + (t.people ? ' × ' + t.people + '人' : '') + split;
  return '¥' + U.money(t.amount) + split;
}

// 流水行"怎么算的"说明
function calcText(c) {
  if (c.calc && c.calc.mode === 'perMu') return '¥' + U.money(c.calc.unitPrice) + '/亩 × ' + c.calc.mu + '亩';
  if (c.calc && c.calc.mode === 'perDay') return c.calc.people + '人 × ¥' + U.money(c.calc.unitPrice);
  if (c.calc && c.calc.mode === 'perJin') return U.money(c.calc.qty) + ' 斤 × ¥' + U.money(c.calc.unitPrice) + '/斤';
  if (c.calc && c.calc.mode === 'perMuPrice') return U.money(c.calc.mu) + ' 亩 × ¥' + U.money(c.calc.unitPrice) + '/亩';
  if (!c.calc && c.people && c.unitPrice) return c.people + '人 × ¥' + U.money(c.unitPrice);
  if (c.expr) return c.expr.replace(/\+/g, '+').replace(/-/g, '−');
  return '';
}

// 欠款汇总（应收 = 别人欠我，应付 = 我欠别人）
function debtSummary() {
  const one = dir => {
    const rows = store.costs.debts(dir);
    const open = rows.filter(c => !c.debt.settled);
    const total = Math.round(open.reduce((s, c) => s + store.allocTotal(c) - (+c.debt.paidAmount || 0), 0) * 100) / 100;
    const today = U.today();
    const overdue = open.filter(c => c.debt.dueDate && c.debt.dueDate < today);
    return {
      rows: rows.map(c => Object.assign({}, c, {
        amount: store.allocTotal(c), amountText: U.money(store.allocTotal(c)),
        remain: Math.round((store.allocTotal(c) - (+c.debt.paidAmount || 0)) * 100) / 100,
        settled: c.debt.settled === true,
        overdue: !!(c.debt.dueDate && c.debt.dueDate < today && !c.debt.settled),
        dueText: c.debt.dueDate ? U.cnDate(c.debt.dueDate) : (c.debt.dueTag || '不约定'),
        kind: C.catOf(c.cat).name + (c.sub ? ' · ' + c.sub : '')
      })),
      total, totalText: U.money(total), count: open.length, overdueCount: overdue.length
    };
  };
  const recv = one('in'), pay = one('out');
  return { receivable: recv, payable: pay, hasAny: recv.count + pay.count > 0 };
}

// 库存汇总：在库、预警、按最近均价折算的市值
function stockSummary() {
  const items = store.stock.items().map(x => {
    const onHand = +x.onHand || 0;
    const low = (+x.warnAt || 0) > 0 && onHand < +x.warnAt;
    return Object.assign({}, x, {
      onHand, onHandText: U.money(onHand), warnText: x.warnAt ? U.money(x.warnAt) + ' ' + (x.unit || '') : '',
      low, value: Math.round(onHand * (+x.lastPrice || 0) * 100) / 100,
      valueText: U.money(Math.round(onHand * (+x.lastPrice || 0))),
      atText: x.at ? U.fmtDate(new Date(x.at)) : ''
    });
  }).sort((a, b) => (a.low === b.low ? b.value - a.value : (a.low ? -1 : 1)));
  const totalValue = Math.round(items.reduce((a, x) => a + x.value, 0) * 100) / 100;
  return { items, totalValue, totalValueText: U.money(totalValue), lowCount: items.filter(x => x.low).length, count: items.length };
}

// 周期账待记（今天到期、且没记过的）
function recurringDue(today) {
  const d = today || U.today();
  return store.recurring.dueList(d).map(r => {
    const cat = C.catOf(r.cat);
    return Object.assign({}, r, {
      catName: cat.name, color: cat.color, icon: C.iconOf(r.sub, r.cat),
      dirName: r.dir === 'in' ? '收入' : '支出',
      amountText: r.mode === 'fixed' ? U.money(r.amount) : U.money(r.unitPrice) + (r.mode === 'perMu' ? '/亩' : r.mode === 'perJin' ? '/斤' : '/人·天'),
      freqName: { week: '每周', month: '每月', quarter: '每季', year: '每年' }[r.freq] || '每月',
      dueDate: d
    });
  });
}

function seasonBrief(season) {
  const plot = store.plots.get(season.plotId) || {};
  const crop = C.cropOf(season.crop);
  const end = store.seasons.endDate(season);
  const cs = costSummary(season.id);
  const ns = netOf(season.id);
  const ws = weatherSeries(season);
  const dayN = U.diffDays(season.sowDate, end > U.today() ? U.today() : end) + 1;
  const perMu = plot.area ? cs.total / plot.area : 0;
  return {
    id: season.id, plotId: plot.id, plotName: plot.name || '未命名地块', area: plot.area,
    crop: crop.name, variety: (season.variety || '').trim(), cropFull: crop.name + ((season.variety || '').trim() ? ' · ' + season.variety.trim() : ''), cropShort: crop.short, cropCls: crop.cls, cropIcon: crop.icon, cropKey: crop.key,
    status: season.status, sowDate: season.sowDate, sowText: U.cnDate(season.sowDate, true),
    harvestDate: season.harvestDate, dayN: dayN < 1 ? 0 : dayN,
    costTotal: cs.total, costText: cs.totalText, perMuText: perMu ? U.money(Math.round(perMu)) : '',
    income: ns.income, incomeText: ns.incomeText, net: ns.net, netText: ns.netText, hasIncome: ns.hasIncome,
    statusText: ns.hasIncome ? (ns.net >= 0 ? '＋¥' + ns.netText : '−¥' + U.money(Math.abs(ns.net))) : '',
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

// ---------- 预算 ----------
// 有效预算：显式总预算优先；没填总预算就用「每亩目标 × 地块面积」；都为空 = 没设预算
function budgetProgress(seasonId) {
  const s = store.seasons.get(seasonId);
  if (!s) return null;
  const b = store.seasons.budget(seasonId);
  const plot = store.plots.get(s.plotId) || {};
  const area = +plot.area || 0;
  const cs = costSummary(seasonId);
  const spent = cs.total;
  const explicitTotal = +b.total || 0;
  const perMuTarget = +b.perMu || 0;
  const eff = explicitTotal > 0 ? explicitTotal
    : (perMuTarget > 0 && area > 0 ? Math.round(perMuTarget * area * 100) / 100 : 0);
  const hasBudget = eff > 0;
  const remain = Math.round((eff - spent) * 100) / 100;
  const perMu = area > 0 ? spent / area : 0;
  const targetCats = b.cats || {};
  const cats = C.COST_CATS.map(c => {
    const hit = cs.cats.find(x => x.key === c.key) || { total: 0 };
    const used = Math.round(hit.total * 100) / 100;
    const target = +targetCats[c.key] || 0;
    return {
      key: c.key, name: c.name, color: c.color, used, target,
      usedText: U.money(used), targetText: U.money(target),
      over: target > 0 && used > target + 0.005,
      pct: target > 0 ? Math.round(used / target * 1000) / 10 : 0
    };
  });
  return {
    seasonId, plotName: plot.name || '', area,
    hasBudget, total: eff, explicitTotal, perMuTarget,
    spent, spentText: U.money(spent),
    remain, remainText: U.money(Math.abs(remain)),
    over: hasBudget && spent > eff + 0.005,
    near: hasBudget && spent <= eff + 0.005 && spent >= eff * 0.9,
    pct: hasBudget ? Math.round(spent / eff * 1000) / 10 : 0,
    perMu: Math.round(perMu * 100) / 100,
    perMuText: area > 0 ? U.money(Math.round(perMu)) : '',
    perMuOver: perMuTarget > 0 && area > 0 && perMu > perMuTarget + 0.005,
    cats
  };
}

// 在种季里「已超支 / 快超支」的，给首页与账本页做提醒条
function budgetAlerts() {
  return store.seasons.growing()
    .map(s => budgetProgress(s.id))
    .filter(b => b && b.hasBudget && b.spent >= b.total * 0.9)
    .sort((a, b) => b.pct - a.pct);
}

// ---------- 资金账户 ----------
// 每个账户：期初 + Σ实收 − Σ实付 = 余额；没挂账户的账不计入
// 挂了赊账（应收/应付）的账只按已销账金额计入——钱没到手就不算进账户，避免和应收重复
function accountRows(filterFn) {
  const rows = store.accounts.items().map(a => ({ key: a.key, name: a.name, init: +a.init || 0, income: 0, expense: 0, count: 0 }));
  const byKey = {}; rows.forEach(r => { byKey[r.key] = r; });
  let noAccount = 0;
  store.costs.all(filterFn).forEach(c => {
    const r = byKey[store.accounts.keyOf(c)];
    if (!r) { noAccount += 1; return; }
    const total = store.allocTotal(c);
    const amt = c.debt ? Math.round((+c.debt.paidAmount || 0) * 100) / 100 : total;
    if (!amt) { r.count += 1; return; }
    if (store.isIncome(c)) r.income += amt; else r.expense += amt;
    r.count += 1;
  });
  let tIn = 0, tEx = 0, tInit = 0;
  rows.forEach(r => {
    r.income = Math.round(r.income * 100) / 100;
    r.expense = Math.round(r.expense * 100) / 100;
    r.net = Math.round((r.income - r.expense) * 100) / 100;
    r.balance = Math.round((r.init + r.net) * 100) / 100;
    r.incomeText = U.money(r.income); r.expenseText = U.money(r.expense);
    r.netText = U.money(r.net); r.balanceText = U.money(r.balance); r.initText = U.money(r.init);
    tIn += r.income; tEx += r.expense; tInit += r.init;
  });
  const totalBalance = Math.round((tInit + tIn - tEx) * 100) / 100;
  return {
    rows, count: rows.length, noAccount,
    totalInit: Math.round(tInit * 100) / 100, totalInitText: U.money(Math.round(tInit * 100) / 100),
    totalBalance, totalBalanceText: U.money(totalBalance),
    totalIncome: Math.round(tIn * 100) / 100, totalIncomeText: U.money(Math.round(tIn * 100) / 100),
    totalExpense: Math.round(tEx * 100) / 100, totalExpenseText: U.money(Math.round(tEx * 100) / 100)
  };
}

// ---------- 资产负债总览 ----------
// 资产 = 账户余额 + 库存估值 + 应收；负债 = 应付；净资产 = 资产 − 负债
function balanceSheet(filterFn) {
  const acc = accountRows(filterFn);
  const ss = stockSummary();
  const ds = debtSummary();
  const cash = acc.totalBalance;
  const stockValue = ss.totalValue;
  const receivable = ds.receivable.total;
  const payable = ds.payable.total;
  const assets = Math.round((cash + stockValue + receivable) * 100) / 100;
  const liabilities = Math.round(payable * 100) / 100;
  const net = Math.round((assets - liabilities) * 100) / 100;
  return {
    cash, cashText: U.money(cash),
    stockValue, stockValueText: U.money(stockValue), stockCount: ss.count,
    receivable, receivableText: U.money(receivable), receivableCount: ds.receivable.count,
    payable, payableText: U.money(payable), payableCount: ds.payable.count,
    assets, assetsText: U.money(assets),
    liabilities, liabilitiesText: U.money(liabilities),
    net, netText: U.money(net), accounts: acc
  };
}

module.exports = {
  costSummary, incomeSummary, netOf, scopeFilter, overview, structureOf, monthlyTrend, bySeasonRows,
  matchesFilter, missingDays,
  debtSummary, stockSummary, recurringDue,
  budgetProgress, budgetAlerts, accountRows, balanceSheet,
  weatherSeries, seasonBrief, seasonYearLabel, logCalendar, costDays, costMonth, costWeek, weekStartOf,
  shiftYm, monthSpend, shortMoney, tplDesc, calcText
};
