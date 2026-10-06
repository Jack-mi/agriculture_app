// 账本（一级 tab）：全部地块统一流水 + 月/周日历 + 多条件筛选 + 待记周期账
// 数据全部本地派生（stats/store 纯函数），不新增云端集合
const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');

const VIEWS = [{ k: 'list', n: '列表' }, { k: 'cal', n: '月历' }, { k: 'week', n: '周历' }];
const TIMES = [{ k: 'month', n: '本月' }, { k: 'year', n: '今年' }, { k: 'all', n: '全部时间' }, { k: 'custom', n: '自定义' }];
const AMT_PRESETS = [
  { n: '¥100 以下', min: '', max: '100' },
  { n: '¥100–1,000', min: '100', max: '1000' },
  { n: '¥1,000–1万', min: '1000', max: '10000' },
  { n: '¥1 万以上', min: '10000', max: '' }
];
const EMPTY = { dir: 'all', cats: [], subs: [], amtMin: '', amtMax: '', from: '', to: '', onlyDebt: false, onlyAttach: false, onlyLinked: false, plotId: '', account: '' };

Page({
  data: {
    q: '', f: Object.assign({}, EMPTY),
    views: VIEWS, view: 'list', times: TIMES, timeKey: 'all', amtPresets: AMT_PRESETS,
    costCats: C.COST_CATS, incomeCats: C.INCOME_CATS, subList: [], plots: [], scopeName: '全部地块',
    days: [], total: {}, chips: [], itemCount: 0,
    cal: null, calYm: '', wk: null, wkStart: '',
    due: [], offline: false, unsynced: 0, hub: {}, sheet: ''
  },

  onLoad(q) { if (q && q.seasonId) this.data.seasonId = q.seasonId; },
  onShow() { this.render(); },
  onPullDownRefresh() { this.render(); wx.stopPullDownRefresh(); },

  // ---------- 取数 ----------
  predicate() {
    const f = Object.assign({}, this.data.f, { seasonId: this.data.seasonId || '' });
    const q = this.data.q;
    return c => stats.matchesFilter(c, f, q);
  },

  // 行渲染
  row(c) {
    const inc = store.isIncome(c);
    const allocs = store.costs.allocOf(c);
    const plots = [];
    allocs.forEach(a => {
      const s = store.seasons.get(a.seasonId);
      const p = s && store.plots.get(s.plotId);
      if (p && p.name && plots.indexOf(p.name) < 0) plots.push(p.name);
    });
    const d = c.debt || {};
    const acct = store.accounts.name(c.account);
    const bits = [];
    if (plots.length) bits.push(plots.join('、'));
    if (acct) bits.push(acct);
    const calcText = stats.calcText(c);
    if (calcText) bits.push(calcText);
    return {
      id: c.id, date: c.date, catName: C.catOf(c.cat).name, sub: c.sub || '', inc,
      subline: bits.join(' · '),
      note: c.note || '',
      icon: C.iconOf(c.sub, c.cat, 'w'),
      amountText: U.money(store.allocTotal(c)),
      calc: stats.calcText(c), note: c.note || '',
      plot: plots.join('、'), shared: allocs.length > 1,
      linked: !!(c.logId && store.logs.get(c.logId)),
      acct: store.accounts.name(c.account),
      debt: d.party ? { party: d.party, open: !d.settled, text: d.settled ? '已结' : '待' + (inc ? '收' : '付') } : null,
      thumbs: (c.attachments || []).slice(0, 3)
    };
  },

  render() {
    const list = store.costs.all(this.predicate());
    const today = U.today();
    // 合计
    let income = 0, expense = 0;
    list.forEach(c => { if (store.isIncome(c)) income += store.allocTotal(c); else expense += store.allocTotal(c); });
    income = Math.round(income * 100) / 100; expense = Math.round(expense * 100) / 100;
    const total = {
      count: list.length, income, expense, net: Math.round((income - expense) * 100) / 100,
      incomeText: U.money(income), expenseText: U.money(expense), netText: U.money(Math.abs(income - expense))
    };
    // 列表：按日分组
    const map = {};
    list.forEach(c => {
      const g = map[c.date] || (map[c.date] = { date: c.date, items: [], income: 0, expense: 0 });
      if (store.isIncome(c)) g.income += store.allocTotal(c); else g.expense += store.allocTotal(c);
      g.items.push(this.row(c));
    });
    const days = Object.keys(map).sort().reverse().map(d => {
      const g = map[d];
      g.dateText = U.cnDate(d); g.week = U.weekday(d);
      g.incomeText = g.income ? U.money(g.income) : '';
      g.expenseText = g.expense ? U.money(g.expense) : '';
      g.bothText = !!(g.income && g.expense);
      return g;
    });
    // 日历/周历
    const opt = this.calOpt();
    const calYm = this.data.calYm || today.slice(0, 7);
    const cal = stats.costMonth({ sowDate: '1900-01-01' }, calYm, opt);
    const wkStart = this.data.wkStart || stats.weekStartOf(today);
    const wk = stats.costWeek({ sowDate: '1900-01-01' }, wkStart, opt);
    // 周期账待记 + 离线
    const due = stats.recurringDue(today);
    const app = getApp() || {};
    const gd = app.globalData || {};
    // 入口卡实时结论
    const ds = stats.debtSummary(), ss = stats.stockSummary();
    const ov = stats.overview(stats.scopeFilter('year', { today }), {});
    const hub = {
      report: { n: '报表', s: '今年净收 ' + (ov.net >= 0 ? '¥' : '−¥') + U.money(Math.abs(ov.net)) },
      debt: ds.hasAny ? { n: '欠款', s: (ds.receivable.count ? '待收 ' + ds.receivable.totalText : '') + (ds.payable.count ? (ds.receivable.count ? ' · ' : '') + '待付 ' + ds.payable.totalText : ''), warn: ds.receivable.overdueCount + ds.payable.overdueCount > 0 }
        : { n: '欠款', s: '没有欠款' },
      stock: ss.lowCount ? { n: '库存', s: ss.items[0].name + '只剩 ' + ss.items[0].onHandText + ss.items[0].unit, warn: true }
        : { n: '库存', s: ss.count ? '在库 ' + ss.count + ' 种' : '还没入库' },
      budget: (bp => (bp && bp.hasBudget)
        ? { n: '预算', s: '本季已用 ' + bp.pct + '%', warn: bp.over }
        : { n: '预算', s: '按季设成本目标' })(stats.budgetProgress((store.seasons.growing()[0] || store.seasons.all()[0] || {}).id)),
      funds: { n: '资金账户', s: '¥' + stats.accountRows(null).totalBalanceText },
      balance: (bs => ({ n: '资产负债', s: '净资产 ' + (bs.net < 0 ? '−' : '') + '¥' + bs.netText, warn: bs.net < 0 }))(stats.balanceSheet())
    };
    // 周期账：单独一张状态卡——有几个、下次哪天，一眼能看见（不再是个小 chip）
    const recs = store.recurring.items().filter(r => r.enabled !== false);
    const recOn = recs.map(r => ({ r, d: store.recurring.nextOn(r, today) }))
      .filter(x => x.d).sort((a, b) => (a.d < b.d ? -1 : 1));
    const rec = recs.length
      ? { title: '周期账 ' + recs.length + ' 个', sub: recOn.length ? '下次 ' + U.cnDate(recOn[0].d) + ' · ' + recOn[0].r.name : '还没到日子' }
      : { title: '周期账', sub: '土地流转、贷款这类固定支出，到日子提醒你去记' };
    // 生效筛选 chip
    const chips = [];
    const f = this.data.f;
    if (f.dir !== 'all') chips.push({ k: 'dir', n: f.dir === 'in' ? '只看收入' : '只看支出' });
    f.cats.forEach(k => chips.push({ k: 'cat:' + k, n: C.catOf(k).name }));
    f.subs.forEach(n => chips.push({ k: 'sub:' + n, n }));
    if (f.amtMin !== '' || f.amtMax !== '') chips.push({ k: 'amt', n: '¥' + (f.amtMin || '0') + '–' + (f.amtMax || '不限') });
    if (f.from || f.to) chips.push({ k: 'time', n: (f.from || '') + ' 起' + (f.to ? ' 至 ' + f.to : '') });
    if (f.onlyDebt) chips.push({ k: 'onlyDebt', n: '只看赊账' });
    if (f.onlyAttach) chips.push({ k: 'onlyAttach', n: '只看带附件' });
    if (f.onlyLinked) chips.push({ k: 'onlyLinked', n: '只看关联记事' });
    if (f.account) chips.push({ k: 'account', n: '账户 · ' + store.accounts.name(f.account) });
    // 筛选用可选项
    const subs = [];
    store.costs.all().forEach(c => { if (c.sub && subs.indexOf(c.sub) < 0) subs.push(c.sub); });
    const plots = store.plots.all().map(p => ({ id: p.id, name: p.name }));
    const scopeName = f.plotId ? ((store.plots.get(f.plotId) || {}).name || '地块') : '全部地块';
    this.setData({
      days, total, hub, due, chips, subList: subs, plots, scopeName, acctList: store.accounts.items(),
      cal, calYm, wk, wkStart,
      offline: gd.online === false, unsynced: store.outbox().length,
      itemCount: list.length, rec
    });
  },

  calOpt() {
    const list = store.costs.all(this.predicate());
    const entries = list.map(c => ({ date: c.date, amount: store.allocTotal(c), dir: store.dirOf(c) }));
    const logged = [];
    store.db().logs.forEach(l => { if (!l.deletedAt && logged.indexOf(l.date) < 0) logged.push(l.date); });
    let min = U.today();
    store.costs.all().forEach(c => { if (c.date < min) min = c.date; });
    store.db().logs.forEach(l => { if (l.date && l.date < min) min = l.date; });
    return { entries, loggedDates: logged, noSeasonLimit: true, noWeather: true, minYm: min.slice(0, 7), maxYm: U.today().slice(0, 7) };
  },

  // ---------- 搜索 / 导航 ----------
  onQ(e) { this.setData({ q: e.detail.value }); this.render(); },
  setView(e) { this.setData({ view: e.currentTarget.dataset.v }); },
  openCost(e) { wx.navigateTo({ url: '/pages/cost-detail/cost-detail?id=' + e.currentTarget.dataset.id }); },
  editCost(e) { wx.navigateTo({ url: '/pages/cost-edit/cost-edit?id=' + e.currentTarget.dataset.id }); },
  addCost() { wx.navigateTo({ url: '/pages/cost-edit/cost-edit' }); },
  goReport() { wx.navigateTo({ url: '/pages/report/report' }); },
  goDebt() { wx.navigateTo({ url: '/pages/debt/debt' }); },
  goStock() { wx.navigateTo({ url: '/pages/stock/stock' }); },
  goBudget() { wx.navigateTo({ url: '/pages/budget/budget' }); },
  goFunds() { wx.navigateTo({ url: '/pages/funds/funds' }); },
  goBalance() { wx.navigateTo({ url: '/pages/balance/balance' }); },
  // 记账设置也收在这页（「我的」只留账号/分享/关于）
  goTags() { wx.navigateTo({ url: '/pages/tags/tags' }); },
  goRecurring() { wx.navigateTo({ url: '/pages/recurring/recurring' }); },
  goKeypanel() { wx.navigateTo({ url: '/pages/keypanel/keypanel' }); },
  goTrash() { wx.navigateTo({ url: '/pages/trash/trash' }); },
  // 连续补账 = 记一笔的「补账模式」：同一套录入能力，日期跟着进度条走
  goCatchup() { wx.navigateTo({ url: '/pages/cost-edit/cost-edit?batch=1' }); },
  goDue() { wx.navigateTo({ url: '/pages/recurring/recurring?due=1' }); },
  goAll() { this.setData({ q: '', f: Object.assign({}, EMPTY), timeKey: 'all' }); this.render(); },

  pickScope() {
    const names = ['全部地块'].concat(this.data.plots.map(p => p.name));
    const ids = [''].concat(this.data.plots.map(p => p.id));
    wx.showActionSheet({
      itemList: names,
      success: r => { const f = Object.assign({}, this.data.f, { plotId: ids[r.tapIndex] }); this.setData({ f }); this.render(); }
    });
  },

  // ---------- 日历翻页 ----------
  calPrev() { if (this.data.cal.canPrev) { this.setData({ calYm: stats.shiftYm(this.data.calYm, -1) }); this.render(); } },
  calNext() { if (this.data.cal.canNext) { this.setData({ calYm: stats.shiftYm(this.data.calYm, 1) }); this.render(); } },
  weekPrev() { this.setData({ wkStart: U.addDays(this.data.wkStart, -7) }); this.render(); },
  weekNext() { this.setData({ wkStart: U.addDays(this.data.wkStart, 7) }); this.render(); },
  openDay(e) {
    const i = e.currentTarget.dataset.i;
    const cell = (this.data.view === 'week' ? this.data.wk : this.data.cal).cells[i];
    if (!cell) return;
    const rows = store.costs.all(c => c.date === cell.date).map(c => this.row(c));
    this.setData({ day: cell, dayRows: rows });
  },
  closeDay() { this.setData({ day: null, dayRows: [] }); },
  addAt(e) { this.setData({ day: null }); wx.navigateTo({ url: '/pages/cost-edit/cost-edit?date=' + e.currentTarget.dataset.date }); },
  editFromDay(e) { this.setData({ day: null }); this.openCost(e); },

  // ---------- 筛选弹层 ----------
  openFilter() { this.setData({ sheet: 'filter' }); },
  closeSheet() { this.setData({ sheet: '' }); },
  noop() {},
  fPickDir(e) { const dir = e.currentTarget.dataset.k; const f = Object.assign({}, this.data.f, { dir }); this.setData({ f }); },
  fToggleCat(e) {
    const k = e.currentTarget.dataset.k;
    const cats = this.data.f.cats.slice();
    const i = cats.indexOf(k);
    if (i >= 0) cats.splice(i, 1); else cats.push(k);
    this.setData({ f: Object.assign({}, this.data.f, { cats }) });
  },
  fToggleSub(e) {
    const n = e.currentTarget.dataset.n;
    const subs = this.data.f.subs.slice();
    const i = subs.indexOf(n);
    if (i >= 0) subs.splice(i, 1); else subs.push(n);
    this.setData({ f: Object.assign({}, this.data.f, { subs }) });
  },
  fAmt(e) { const k = e.currentTarget.dataset.k; this.setData({ f: Object.assign({}, this.data.f, { [k]: e.detail.value }) }); },
  fAmtPreset(e) {
    const i = e.currentTarget.dataset.i, p = AMT_PRESETS[i];
    this.setData({ f: Object.assign({}, this.data.f, { amtMin: p.min, amtMax: p.max }) });
  },
  fTime(e) {
    const k = e.currentTarget.dataset.k, t = U.today();
    let from = '', to = '';
    if (k === 'month') from = t.slice(0, 7) + '-01';
    else if (k === 'year') from = t.slice(0, 4) + '-01-01';
    this.setData({ f: Object.assign({}, this.data.f, { from, to: k === 'all' ? '' : t }), timeKey: k });
  },
  fDate(e) { const k = e.currentTarget.dataset.k; this.setData({ f: Object.assign({}, this.data.f, { [k]: e.detail.value }) }); },
  fPlot(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ f: Object.assign({}, this.data.f, { plotId: this.data.f.plotId === id ? '' : id }) });
  },
  fFlag(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ f: Object.assign({}, this.data.f, { [k]: !this.data.f[k] }) });
  },
  fClear() { this.setData({ f: Object.assign({}, EMPTY), timeKey: 'all' }); },
  pickAcct(e) { this.setData({ f: Object.assign({}, this.data.f, { account: e.currentTarget.dataset.k }) }); },
  fApply() { this.setData({ sheet: '' }); this.render(); },
  dropChip(e) {
    const k = e.currentTarget.dataset.k, f = Object.assign({}, this.data.f);
    if (k === 'dir') f.dir = 'all';
    else if (k.indexOf('cat:') === 0) f.cats = f.cats.filter(x => x !== k.slice(4));
    else if (k.indexOf('sub:') === 0) f.subs = f.subs.filter(x => x !== k.slice(4));
    else if (k === 'amt') { f.amtMin = ''; f.amtMax = ''; }
    else if (k === 'time') { f.from = ''; f.to = ''; this.data.timeKey = 'all'; }
    else if (k === 'account') f.account = '';
    else f[k] = false;
    this.setData({ f }); this.render();
  }
});
