const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const weather = require('../../utils/weather.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');
const advisor = require('../../utils/advisor.js');

Page({
  data: {
    id: '', tab: 'advisor', adv: null, brief: {}, season: {}, plot: {},
    cost: { cats: [], total: 0 }, costList: [], openCat: '',
    logGroups: [], costView: 'list', costDays: [], calYm: '', cal: null, daySheet: null, costFilter: '', logFilter: '', costSubs: [], logTags: [], met: {}, bars: [], seasonInfo: {}, wxRows: [], wxLoading: false, wxMsg: '',
    wkStart: '', wk: null, nv: {}, sd: {},
    edit: null
  },

  onLoad(q) {
    const s = store.seasons.get(q.id);
    // 在种的季默认打开「参谋」；已收获的季默认「账本」
    this.setData({ id: q.id, tab: q.tab || (s && s.status === 'growing' ? 'advisor' : 'cost') });
  },
  onShow() { this.render(); this.loadWeather(); },

  render() {
    const s = store.seasons.get(this.data.id);
    if (!s) { wx.navigateBack(); return; }
    const plot = store.plots.get(s.plotId) || {};
    if (s.status === 'growing') advisor.refreshSeason(s);
    this.setData({ adv: s.status === 'growing' ? advisor.seasonPanel(s) : null });
    const brief = stats.seasonBrief(s);
    wx.setNavigationBarTitle({ title: plot.name + ' · ' + brief.crop });

    const cost = stats.costSummary(s.id);
    const cf = this.data.costFilter, lf = this.data.logFilter;
    const allCosts = store.costs.bySeason(s.id);
    // 筛选胶囊：本季出现过的细分类型
    const costSubs = []; allCosts.forEach(c => { const k = c.cat + '|' + c.sub; if (c.sub && !costSubs.some(x => x.k === k)) costSubs.push({ k, name: c.sub, color: C.catOf(c.cat).color }); });
    const costRow = c => ({
      id: c.id, date: c.date, dateText: U.cnDate(c.date), cat: c.cat, catName: C.catOf(c.cat).name,
      color: C.catOf(c.cat).color, sub: c.sub, icon: C.iconOf(c.sub, c.cat), note: c.note,
      calc: stats.calcText(c), people: c.people, amount: U.money(store.costs.amountFor(c, s.id)),
      shared: store.costs.allocOf(c).length > 1, linked: !!(c.logId && store.logs.get(c.logId)), inc: store.isIncome(c)
    });
    const costList = allCosts.filter(c => !cf || (c.cat + '|' + c.sub) === cf).map(costRow);
    // 按日分组（随手记式）：组头 = 日期 · 第几天 · 当天合计（本季分摊口径）
    const costDays = stats.costDays(s, c => !cf || (c.cat + '|' + c.sub) === cf).map(g => ({
      date: g.date, dateText: U.cnDate(g.date), week: U.weekday(g.date), dayN: g.dayN,
      totalText: U.money(g.total), items: g.items.map(costRow)
    }));
    // 流水日历：默认到季末所在月（在种 = 本月）
    let calYm = this.data.calYm;
    if (!calYm) { const e = store.seasons.endDate(s); calYm = (e > U.today() ? U.today() : e).slice(0, 7); }
    const cal = stats.costMonth(s, calYm);
    this._costRow = costRow;

    // 全生育周期连续日历：播种日 → 收获日/今天，倒序；无记录日期显示「本日未记录」
    const allLogs = store.logs.bySeason(s.id);
    const logTags = []; allLogs.forEach(l => (l.ops || []).forEach(o => { if (!logTags.some(t => t.name === o)) logTags.push({ name: o, color: store.tags.colorOf(o) }); }));
    const matText = l => store.logs.materialsOf(l).map(m => (m.type !== '化肥' || !m.name ? m.type + (m.name ? '·' + m.name : '') : m.name) + (m.rate !== '' && m.rate !== undefined ? ' ' + m.rate + m.unit : '')).join('、');
    const logGroups = stats.logCalendar(s).reverse().map(day => {
      const items = day.logs.filter(l => !lf || (l.ops || []).indexOf(lf) >= 0).map(l => {
        const cost = store.db().costs.filter(c => !c.deletedAt && !store.isIncome(c) && c.logId === l.id).reduce((a, c) => a + store.costs.amountFor(c, s.id), 0);
        return {
          id: l.id, opTags: (l.ops || []).map(o => ({ name: o, color: store.tags.colorOf(o) })), text: l.text,
          growth: l.growth || '', pest: l.pest || '', machine: l.machine || '',
          areaMu: l.areaMu ? l.areaMu + ' 亩' : '',
          materials: matText(l),
          moisture: l.moisture,
          costText: cost ? U.money(cost) : ''
        };
      });
      const w = day.weather;
      return {
        date: day.date, dateText: U.cnDate(day.date), week: U.weekday(day.date), dayN: day.dayN,
        w: w ? w.t + '℃ · ' + w.p + 'mm' + (w.wind !== undefined && w.wind !== null && w.wind !== '' ? ' · 风' + w.wind + 'm/s' : '') : '',
        items, empty: !items.length
      };
    }).filter(g => !lf || !g.empty);

    const ws = stats.weatherSeries(s);
    const wxRows = ws.rows.slice().reverse().map(r => Object.assign(r, {
      dateText: U.cnDate(r.date), dayN: U.diffDays(s.sowDate, r.date) + 1,
      tText: r.has ? r.t : '—', pText: r.has ? r.p : '—', windText: r.wind !== null ? r.wind : '—'
    }));
    // 降雨柱状（近 30 天）
    const last = ws.rows.slice(-30);
    const maxP = Math.max(5, ...last.map(r => r.p || 0));
    const bars = last.map(r => ({ d: r.date.slice(5), h: r.p ? Math.max(4, Math.round(r.p / maxP * 100)) : 0, p: r.p }));
    // 本季净收益 / 待收待付
    const ns = stats.netOf(s.id);
    const nv = {
      income: ns.incomeText, expense: ns.expenseText, net: ns.netText, netPos: ns.net >= 0,
      hasIncome: ns.hasIncome, inPct: ns.income + ns.expense ? Math.round(ns.income / (ns.income + ns.expense) * 100) : 0,
      catText: ns.hasIncome && plot.area ? '¥' + Math.round(ns.net / plot.area) + '/亩' : ''
    };
    const myDebts = store.costs.bySeason(s.id).filter(c => c.debt);
    const sd = {
      recv: U.money(myDebts.filter(c => store.isIncome(c) && !c.debt.settled).reduce((a, c) => a + store.allocTotal(c) - (+c.debt.paidAmount || 0), 0)),
      pay: U.money(myDebts.filter(c => !store.isIncome(c) && !c.debt.settled).reduce((a, c) => a + store.allocTotal(c) - (+c.debt.paidAmount || 0), 0)),
      has: myDebts.some(c => !c.debt.settled)
    };
    // 周历
    const wkStart = this.data.wkStart || stats.weekStartOf(calYm === U.today().slice(0, 7) ? U.today() : store.seasons.endDate(s));
    const wk = stats.costWeek(s, wkStart);

    this.setData({
      season: s, plot, brief, cost, costList, costDays, calYm, cal, logGroups, costSubs, logTags, costTotalCount: allCosts.length,
      budget: (b => (b ? Object.assign(b, { barW: Math.min(100, b.pct), totalText2: U.money(b.total) }) : null))(stats.budgetProgress(s.id)),
      nv, sd, wkStart, wk,
      costFilterSum: cf ? U.money(allCosts.filter(c => (c.cat + '|' + c.sub) === cf).reduce((a, c) => a + store.costs.amountFor(c, s.id), 0)) : '',
      met: { gdd: ws.gdd, gdd0: ws.gdd0, rain: ws.rain, days: ws.days, known: ws.known, missing: ws.missing, manual: ws.manual, maxWind: ws.maxWind, hasLoc: plot.lat !== undefined && plot.lat !== '' },
      wxRows, bars,
      seasonInfo: {
        sow: U.cnDate(s.sowDate, true), seed: s.seedRate ? s.seedRate + ' 斤/亩' : '未填',
        tillage: s.tillage || '未填',
        harvest: s.harvestDate ? U.cnDate(s.harvestDate, true) : '',
        yieldText: s.yieldJin ? U.money(s.yieldJin) + ' 斤' : '',
        perMuYield: s.yieldJin && plot.area ? U.money(Math.round(s.yieldJin / plot.area)) + ' 斤/亩' : '',
        costPerJin: s.yieldJin && cost.total ? (cost.total / s.yieldJin).toFixed(2) + ' 元/斤' : ''
      }
    });
  },

  loadWeather(force) {
    const s = store.seasons.get(this.data.id);
    if (!s) return;
    this.setData({ wxLoading: true, wxMsg: '' });
    weather.fillSeason(s, { force }).then(r => {
      let msg = '';
      if (!r.ok && r.reason === 'nolocation') msg = '地块未定位，无法自动获取天气';
      else if (!r.ok) msg = '网络不好，天气稍后自动补齐';
      this.setData({ wxLoading: false, wxMsg: msg });
      this.render();
    }).catch(() => this.setData({ wxLoading: false }));
  },

  setCostView(e) { this.setData({ costView: e.currentTarget.dataset.v }); },
  calPrev() { if (this.data.cal.canPrev) { this.setData({ calYm: stats.shiftYm(this.data.calYm, -1) }); this.render(); } },
  calNext() { if (this.data.cal.canNext) { this.setData({ calYm: stats.shiftYm(this.data.calYm, 1) }); this.render(); } },
  weekPrev() { this.setData({ wkStart: U.addDays(this.data.wkStart, -7) }); this.render(); },
  weekNext() { this.setData({ wkStart: U.addDays(this.data.wkStart, 7) }); this.render(); },
  goCatchup() { wx.navigateTo({ url: '/pages/catchup/catchup?seasonId=' + this.data.id }); },
  goDebt() { wx.navigateTo({ url: '/pages/debt/debt' }); },
  goBudget() { wx.navigateTo({ url: '/pages/budget/budget?seasonId=' + this.data.id }); },
  // 点日历某天：弹出当天记事 + 账目，可按该日期补记
  openDay(e) {
    const src = this.data.costView === 'week' ? this.data.wk : this.data.cal;
    const cell = src && src.cells[e.currentTarget.dataset.i];
    if (!cell || !cell.inSeason || cell.future) return;
    const s = this.data.season;
    const w = store.weather.get(s.plotId, cell.date);
    const costs = store.costs.bySeason(s.id).filter(c => c.date === cell.date).map(this._costRow);
    const logs = store.logs.bySeason(s.id).filter(l => l.date === cell.date).map(l => ({
      id: l.id, text: l.text || '', opTags: (l.ops || []).map(o => ({ name: o, color: store.tags.colorOf(o) }))
    }));
    const total = store.costs.bySeason(s.id).filter(c => c.date === cell.date).reduce((a, c) => a + store.costs.amountFor(c, s.id), 0);
    this.setData({ daySheet: {
      date: cell.date, title: U.cnDate(cell.date) + ' ' + U.weekday(cell.date), dayN: U.diffDays(s.sowDate, cell.date) + 1,
      w: w ? w.t + '℃ · ' + w.p + 'mm' : '天气待补', costs, logs, totalText: U.money(total)
    } });
  },
  closeDay() { this.setData({ daySheet: null }); },
  addCostAt(e) { const d = e.currentTarget.dataset.date; this.setData({ daySheet: null }); wx.navigateTo({ url: '/pages/cost-edit/cost-edit?seasonId=' + this.data.id + '&date=' + d }); },
  addLogAtDay(e) { const d = e.currentTarget.dataset.date; this.setData({ daySheet: null }); wx.navigateTo({ url: '/pages/log-edit/log-edit?seasonId=' + this.data.id + '&date=' + d }); },
  editCostFromDay(e) { this.setData({ daySheet: null }); this.openCost(e); },
  editLogFromDay(e) { this.setData({ daySheet: null }); this.editLog(e); },
  setCostFilter(e) { const k = e.currentTarget.dataset.k || ''; this.setData({ costFilter: this.data.costFilter === k ? '' : k }); this.render(); },
  setLogFilter(e) { const k = e.currentTarget.dataset.k || ''; this.setData({ logFilter: this.data.logFilter === k ? '' : k }); this.render(); },
  goTags() { wx.navigateTo({ url: '/pages/tags/tags?tab=' + (this.data.tab === 'log' ? 'log' : 'cost') }); },
  goTask(e) { wx.navigateTo({ url: '/pages/task/task?id=' + encodeURIComponent(e.currentTarget.dataset.id) }); },
  talkSeason() { wx.navigateTo({ url: '/pages/chat/chat?seasonId=' + this.data.id }); },
  talkStage() { wx.navigateTo({ url: '/pages/chat/chat?seasonId=' + this.data.id }); },
  goWx() { this.setData({ tab: 'wx' }); },
  setTab(e) { this.setData({ tab: e.currentTarget.dataset.t }); },
  toggleCat(e) { const k = e.currentTarget.dataset.k; this.setData({ openCat: this.data.openCat === k ? '' : k }); },

  addCost() { wx.navigateTo({ url: '/pages/cost-edit/cost-edit?seasonId=' + this.data.id }); },
  openCost(e) { wx.navigateTo({ url: '/pages/cost-detail/cost-detail?id=' + e.currentTarget.dataset.id }); },
  editCost(e) { wx.navigateTo({ url: '/pages/cost-edit/cost-edit?id=' + e.currentTarget.dataset.id }); },
  addLog() { wx.navigateTo({ url: '/pages/log-edit/log-edit?seasonId=' + this.data.id }); },
  addLogAt(e) { wx.navigateTo({ url: '/pages/log-edit/log-edit?seasonId=' + this.data.id + '&date=' + e.currentTarget.dataset.date }); },
  editLog(e) { wx.navigateTo({ url: '/pages/log-edit/log-edit?id=' + e.currentTarget.dataset.id }); },
  harvest() { wx.navigateTo({ url: '/pages/harvest/harvest?id=' + this.data.id }); },
  goPlot() { wx.navigateTo({ url: '/pages/plot-edit/plot-edit?id=' + this.data.season.plotId }); },
  refreshWx() { this.loadWeather(true); },

  // 手工修正天气
  editWx(e) {
    const r = this.data.wxRows[e.currentTarget.dataset.i];
    this.setData({ edit: { date: r.date, dateText: U.cnDate(r.date, true), t: r.has ? String(r.t) : '', p: r.has ? String(r.p) : '', wind: r.wind !== null ? String(r.wind) : '', src: r.src } });
  },
  onEditT(e) { this.setData({ 'edit.t': e.detail.value }); },
  onEditP(e) { this.setData({ 'edit.p': e.detail.value }); },
  onEditWind(e) { this.setData({ 'edit.wind': e.detail.value }); },
  closeEdit() { this.setData({ edit: null }); },
  noop() {},
  saveEdit() {
    const ed = this.data.edit;
    const t = parseFloat(ed.t), p = parseFloat(ed.p);
    if (isNaN(t)) return U.toast('请填写平均气温');
    store.weather.setManual(this.data.season.plotId, ed.date, t, isNaN(p) ? 0 : p, ed.wind);
    this.setData({ edit: null });
    this.render();
    U.toast('已修正', 'success');
  },
  resetEdit() {
    store.weather.resetToApi(this.data.season.plotId, this.data.edit.date);
    this.setData({ edit: null });
    this.loadWeather();
  },

  // 品种（选填）：随时补填 / 修改；快捷选项 = 用过的 + 常见品种
  editVariety() {
    const s = this.data.season;
    const opts = store.seasons.varieties(s.crop).all.filter(v => v !== s.variety).slice(0, 5);
    const items = ['手动输入…'].concat(opts);
    if (s.variety) items.push('清空品种');
    wx.showActionSheet({
      itemList: items,
      success: r => {
        const pick = items[r.tapIndex];
        if (r.tapIndex === 0) {
          wx.showModal({
            title: C.cropOf(s.crop).name + '品种', editable: true, content: s.variety || '', placeholderText: s.crop === 'corn' ? '如：登海605' : '如：济麦22',
            success: m => { if (m.confirm) this.setVariety((m.content || '').trim()); }
          });
        } else if (pick === '清空品种') this.setVariety('');
        else this.setVariety(pick);
      }
    });
  },
  setVariety(v) {
    store.seasons.save({ id: this.data.id, variety: v.slice(0, 20) });
    this.render();
    U.toast(v ? '已记录品种' : '已清空');
  },

  delSeason() {
    wx.showModal({
      title: '删除这一季', content: '这一季的记事会删除；只分摊到这一季的账目也会删除，多季共用的账目保留其他季的分摊。', confirmText: '删除', confirmColor: '#B3372B',
      success: r => { if (r.confirm) { store.seasons.remove(this.data.id); wx.navigateBack(); } }
    });
  },
  reopen() {
    wx.showModal({
      title: '撤销收获', content: '恢复为"在种"状态？', success: r => {
        if (!r.confirm) return;
        if (store.seasons.current(this.data.season.plotId)) return U.toast('这块地已有在种的季');
        store.seasons.save({ id: this.data.id, status: 'growing', harvestDate: '' });
        this.render();
      }
    });
  },

  onShareAppMessage() {
    const b = this.data.brief;
    return { title: b.plotName + ' ' + b.crop + ' · 已投入¥' + b.costText, path: '/pages/index/index' };
  }
});
