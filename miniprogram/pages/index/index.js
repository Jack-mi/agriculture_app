// 今天：按时间看 —— 天气与预警 · 待办（马上办 / 这周 / 往后折叠）· 生育期小卡 · 记录入口
// 有事是待办清单；没事写明「今天地里没有要紧的事」+ 下一件预告 + 最近记的
const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const weather = require('../../utils/weather.js');
const advisor = require('../../utils/advisor.js');
const U = require('../../utils/util.js');
const C = require('../../utils/const.js');

Page({
  data: { todayText: '', week: '', hasPlots: false, growing: 0, online: true, wxLine: '', month: '0', v: null, showLater: false, recent: [], tpls: [], loading: false,
    money: {}, debt: {}, stock: {}, dueCount: 0 },

  onShow() {
    this.render();
    this.setData({ loading: true });
    weather.fillAllGrowing()
      .then(() => advisor.refreshAll())
      .then(() => { this.setData({ loading: false }); this.render(); })
      .catch(() => this.setData({ loading: false }));
  },
  onPullDownRefresh() {
    weather.fillAllGrowing().then(() => advisor.refreshAll(true)).then(() => { this.render(); wx.stopPullDownRefresh(); }).catch(() => wx.stopPullDownRefresh());
  },

  render() {
    const t = U.today();
    const growing = store.seasons.growing();
    const v = advisor.today();
    // 顶部天气：第一块在种地的今日预报 / 实况
    let wxLine = '';
    const s0 = growing[0];
    if (s0) {
      const fc = advisor.forecastOf(s0.plotId).find(f => f.date === t);
      const w = store.weather.get(s0.plotId, t) || store.weather.get(s0.plotId, U.addDays(t, -1));
      const p = store.plots.get(s0.plotId) || {};
      const rain7 = advisor.forecastOf(s0.plotId).filter(f => f.date > t).slice(0, 7).some(f => f.p >= 1);
      if (fc && fc.tmin !== null) wxLine = (p.address || p.name || '') + ' · ' + Math.round(fc.tmin) + '–' + Math.round(fc.tmax) + '℃' + (fc.p >= 1 ? ' · 今天有雨 ' + fc.p + 'mm' : '') + (!rain7 && advisor.forecastOf(s0.plotId).length ? ' · 未来 7 天无雨' : '');
      else if (w) wxLine = (p.name || '') + ' · 均温 ' + w.t + '℃ · 降雨 ' + w.p + 'mm';
    }
    // 最近记的（日志 + 账目混排，最多 3 条）
    const d = store.db();
    const plotOf = sid => { const s = store.seasons.get(sid); return s ? (store.plots.get(s.plotId) || {}).name : ''; };
    const recent = d.logs.filter(l => !l.deletedAt).map(l => ({ id: l.id, kind: 'log', date: l.date, at: l.createdAt, title: (l.ops || []).join(' · ') || '记事', sub: plotOf(l.seasonId) + (l.text ? ' · ' + l.text.slice(0, 14) : ''), amt: '', inc: false }))
      .concat(d.costs.filter(c => !c.deletedAt).map(c => ({
        id: c.id, kind: 'cost', date: c.date, at: c.createdAt,
        title: C.catOf(c.cat).name + ' · ' + (c.sub || ''),
        sub: store.costs.allocOf(c).map(a => plotOf(a.seasonId)).join('、'),
        amt: (store.isIncome(c) ? '＋' : '−') + '¥' + U.money(store.allocTotal(c)),
        inc: store.isIncome(c)
      })))
      .sort((a, b) => (a.date === b.date ? b.at - a.at : (b.date > a.date ? 1 : -1))).slice(0, 3)
      .map(x => Object.assign(x, { dateText: (+x.date.slice(5, 7)) + '/' + (+x.date.slice(8)) }));
    const tpls = store.tags.templates().slice(0, 6).map(x => ({ id: x.id, name: x.name, icon: C.iconOf(x.sub, x.cat), color: C.catOf(x.cat).color, desc: stats.tplDesc(x) }));
    // 本月收支与净收
    const ms = stats.monthSpend(t.slice(0, 7));
    const money = {
      income: ms.incomeText, expense: ms.totalText, net: ms.netText, netPos: ms.net >= 0,
      hasIncome: ms.income > 0, hasAny: ms.income > 0 || ms.total > 0
    };
    // 待收待付
    const ds = stats.debtSummary();
    const debt = {
      has: ds.hasAny,
      recv: ds.receivable.totalText, recvCount: ds.receivable.count, recvOverdue: ds.receivable.overdueCount,
      pay: ds.payable.totalText, payCount: ds.payable.count,
      overdue: ds.receivable.overdueCount + ds.payable.overdueCount
    };
    // 库存预警（只提醒最低的一项）
    const ss = stats.stockSummary();
    const lowItem = ss.items.filter(x => x.low)[0];
    const stock = lowItem ? { warn: true, text: lowItem.name + '只剩 ' + lowItem.onHandText + lowItem.unit + '，低于预警' } : { warn: false, count: ss.count };
    const dueCount = stats.recurringDue(t).length;
    // 预算提醒（在种季里已超支 / 快超支的，只提醒最紧张的一季）
    const bAlerts = stats.budgetAlerts();
    const budget = bAlerts.length ? {
      n: bAlerts.length, plotName: bAlerts[0].plotName, pct: bAlerts[0].pct,
      over: bAlerts[0].over, remainText: bAlerts[0].remainText
    } : null;
    // 在种季卡：总投入 / 已收 / 净收益（一眼看到这一季怎么样）
    const briefs = growing.map(s => {
      const b = stats.seasonBrief(s);
      return {
        id: s.id, plotName: b.plotName, crop: b.crop, dayN: b.dayN, area: b.area,
        cost: b.costText, income: b.incomeText, net: b.netText, netPos: b.net >= 0, hasIncome: b.hasIncome,
        perMu: b.perMuText, cls: b.cropCls, icon: b.cropIcon
      };
    });
    this.setData({
      todayText: U.cnDate(t), week: U.weekday(t), hasPlots: store.plots.all().length > 0, growing: growing.length,
      online: getApp().globalData.online, wxLine, month: ms.totalText,
      v, recent, tpls, money, debt, stock, dueCount, briefs, budget,
      nextText: v.nextTask ? v.nextTask.plot + ' ' + v.nextTask.title : '',
      nextDue: v.nextTask ? v.nextTask.due : ''
    });
    wx.setTabBarBadge && (v.count ? wx.setTabBarBadge({ index: 0, text: String(v.count) }) : wx.removeTabBarBadge({ index: 0 }));
  },

  toggleLater() { this.setData({ showLater: !this.data.showLater }); },
  goTask(e) { wx.navigateTo({ url: '/pages/task/task?id=' + encodeURIComponent(e.currentTarget.dataset.id) }); },
  goAlert(e) { wx.navigateTo({ url: '/pages/alert/alert?key=' + encodeURIComponent(e.currentTarget.dataset.key) }); },
  goSeason(e) { wx.navigateTo({ url: '/pages/season/season?id=' + e.currentTarget.dataset.id + '&tab=advisor' }); },
  goRecent(e) {
    const { id, kind } = e.currentTarget.dataset;
    wx.navigateTo({ url: kind === 'log' ? '/pages/log-edit/log-edit?id=' + id : '/pages/cost-detail/cost-detail?id=' + id });
  },
  pickSeason(cb) {
    const g = store.seasons.growing();
    if (!g.length) return U.toast('先开一季');
    if (g.length === 1) return cb(g[0].id);
    wx.showActionSheet({ itemList: g.map(s => (store.plots.get(s.plotId) || {}).name + ' · ' + C.cropOf(s.crop).name), success: r => cb(g[r.tapIndex].id) });
  },
  addCost() { this.pickSeason(id => wx.navigateTo({ url: '/pages/cost-edit/cost-edit?seasonId=' + id })); },
  addLog() { this.pickSeason(id => wx.navigateTo({ url: '/pages/log-edit/log-edit?seasonId=' + id })); },
  talk() { wx.navigateTo({ url: '/pages/chat/chat' }); },
  useTpl(e) {
    const g = store.seasons.growing();
    if (!g.length) return U.toast('先开一季再记账');
    wx.navigateTo({ url: '/pages/cost-edit/cost-edit?seasonId=' + g[0].id + '&tpl=' + e.currentTarget.dataset.id });
  },
  goTpl() { wx.navigateTo({ url: '/pages/tags/tags?tab=tpl' }); },
  goLedger() { wx.switchTab({ url: '/pages/ledger/ledger' }); },
  goDebt() { wx.navigateTo({ url: '/pages/debt/debt' }); },
  goStock() { wx.navigateTo({ url: '/pages/stock/stock' }); },
  goReport() { wx.navigateTo({ url: '/pages/report/report' }); },
  goBudget() { wx.navigateTo({ url: '/pages/budget/budget' }); },
  goDue() { wx.navigateTo({ url: '/pages/recurring/recurring?due=1' }); },
  addPlot() { wx.navigateTo({ url: '/pages/plot-edit/plot-edit' }); },
  newSeason() { wx.navigateTo({ url: '/pages/season-new/season-new' }); }
});
