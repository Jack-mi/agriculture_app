// 我的：年度收支与净收益 · 报表/欠款/库存入口 · 设置（类型/周期账/键盘/回收站）· 云备份状态
const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const U = require('../../utils/util.js');
const sync = require('../../utils/sync.js');

Page({
  data: { counts: {}, year: '', y: {}, debt: {}, stock: {}, trash: 0, recCount: 0, recNext: '', sync: {} },

  onShow() {
    const d = store.db();
    const ym = U.today().slice(0, 4);
    const filter = stats.scopeFilter('year', { today: U.today() });
    const ov = stats.overview(filter, {});
    const ds = stats.debtSummary();
    const ss = stats.stockSummary();
    const recs = store.recurring.items();
    const nextRec = recs.filter(r => r.enabled !== false).sort((a, b) => (a.day || 1) - (b.day || 1))[0];
    const gd = (getApp() || {}).globalData || {};
    this.setData({
      year: ym,
      y: {
        income: ov.incomeText, expense: ov.expenseText, net: ov.netText, netPos: ov.net >= 0,
        inPct: ov.income + ov.expense ? Math.round(ov.income / (ov.income + ov.expense) * 100) : 0
      },
      debt: { has: ds.hasAny, recv: ds.receivable.totalText, pay: ds.payable.totalText, count: ds.receivable.count + ds.payable.count },
      stock: { count: ss.count, low: ss.lowCount, value: ss.totalValueText },
      bs: (bs => ({ net: bs.netText, netNeg: bs.net < 0, assets: bs.assetsText, liab: bs.liabilitiesText, cash: bs.cashText }))(stats.balanceSheet()),
      budget: (bp => (bp && bp.hasBudget ? { pct: bp.pct, over: bp.over } : null))(stats.budgetProgress((store.seasons.growing()[0] || store.seasons.all()[0] || {}).id)),
      trash: store.trash.count(),
      recCount: recs.length,
      recNext: nextRec ? nextRec.name + ' · 每月 ' + (nextRec.day || 1) + ' 号' : '',
      counts: { plots: d.plots.length, seasons: d.seasons.length, costs: d.costs.filter(c => !c.deletedAt).length, logs: d.logs.filter(l => !l.deletedAt).length },
      sync: { enabled: !!gd.cloudEnv, online: gd.online !== false, pending: store.outbox().length }
    });
  },

  goTags() { wx.navigateTo({ url: '/pages/tags/tags' }); },
  goReport() { wx.navigateTo({ url: '/pages/report/report' }); },
  goBudget() { wx.navigateTo({ url: '/pages/budget/budget' }); },
  goFunds() { wx.navigateTo({ url: '/pages/funds/funds' }); },
  goBalance() { wx.navigateTo({ url: '/pages/balance/balance' }); },
  goDebt() { wx.navigateTo({ url: '/pages/debt/debt' }); },
  goStock() { wx.navigateTo({ url: '/pages/stock/stock' }); },
  goRecurring() { wx.navigateTo({ url: '/pages/recurring/recurring' }); },
  goKeypanel() { wx.navigateTo({ url: '/pages/keypanel/keypanel' }); },
  goTrash() { wx.navigateTo({ url: '/pages/trash/trash' }); },
  goLedger() { wx.switchTab({ url: '/pages/ledger/ledger' }); },
  syncNow() {
    if (!this.data.sync.enabled) return wx.showModal({ title: '没开云备份', content: '在 app.js 里填上云开发环境 ID 就会自动备份，换手机也能拉回来。', showCancel: false });
    U.toast('正在同步…');
    sync.login().then(() => sync.pull()).then(() => sync.flush())
      .then(() => { U.toast('同步完成', 'success'); this.onShow(); })
      .catch(() => U.toast('同步失败，联网后会自动重试'));
  },
  about() {
    wx.showModal({
      title: '关于谷雨记',
      content: '谷雨种谷，雨生百谷。记下作物生长的每一场雨、每一天。\n天气数据来自 Open-Meteo 开源天气。',
      showCancel: false
    });
  },
  onShareAppMessage() { return { title: '谷雨记 · 种地记账本，比纸本好用', path: '/pages/index/index' }; }
});
