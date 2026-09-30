const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const weather = require('../../utils/weather.js');
const U = require('../../utils/util.js');
const C = require('../../utils/const.js');

Page({
  data: { todayText: '', week: '', cards: [], hasPlots: false, online: true, loadingWx: false, month: null, tpls: [] },

  onShow() { this.render(); this.refreshWeather(); },

  onPullDownRefresh() {
    this.refreshWeather(true).then(() => wx.stopPullDownRefresh());
  },

  render() {
    const t = U.today();
    const cards = store.seasons.growing().map(s => {
      const b = stats.seasonBrief(s);
      const w = store.weather.get(s.plotId, t) || store.weather.get(s.plotId, U.addDays(t, -1));
      const todayLogs = store.logs.bySeason(s.id).filter(l => l.date === t);
      const todayCost = store.costs.bySeason(s.id).filter(c => c.date === t).reduce((a, c) => a + store.costs.amountFor(c, s.id), 0);
      return Object.assign(b, {
        wT: w ? w.t : '--', wP: w ? w.p : '--',
        todayDone: todayLogs.length > 0,
        todayOps: todayLogs.map(l => (l.ops || []).join('、') || '记事').join('；'),
        todayCost: todayCost ? U.money(todayCost) : ''
      });
    });
    const ms = stats.monthSpend(t.slice(0, 7));
    const tpls = store.tags.templates().slice(0, 6).map(x => ({ id: x.id, name: x.name, icon: C.iconOf(x.sub, x.cat), color: C.catOf(x.cat).color, desc: stats.tplDesc(x) }));
    this.setData({
      month: { label: (+t.slice(5, 7)) + ' 月 · 全部地块', total: U.money(ms.total), today: U.money(ms.today), hasToday: ms.today > 0 },
      tpls,
      todayText: U.cnDate(t), week: U.weekday(t), cards,
      hasPlots: store.plots.all().length > 0,
      online: getApp().globalData.online
    });
  },

  refreshWeather() {
    this.setData({ loadingWx: true });
    return weather.fillAllGrowing().then(() => { this.setData({ loadingWx: false }); this.render(); });
  },

  goSeason(e) { wx.navigateTo({ url: '/pages/season/season?id=' + e.currentTarget.dataset.id }); },
  addCost(e) { wx.navigateTo({ url: '/pages/cost-edit/cost-edit?seasonId=' + e.currentTarget.dataset.id }); },
  addLog(e) { wx.navigateTo({ url: '/pages/log-edit/log-edit?seasonId=' + e.currentTarget.dataset.id }); },
  // 常用账：进入记一笔并带出模板（多季在种时带入第一季，模板可要求均摊）
  useTpl(e) {
    const g = store.seasons.growing();
    if (!g.length) return U.toast('先开一季再记账');
    wx.navigateTo({ url: '/pages/cost-edit/cost-edit?seasonId=' + g[0].id + '&tpl=' + e.currentTarget.dataset.id });
  },
  goTpl() { wx.navigateTo({ url: '/pages/tags/tags?tab=tpl' }); },
  addPlot() { wx.navigateTo({ url: '/pages/plot-edit/plot-edit' }); },
  newSeason() { wx.navigateTo({ url: '/pages/season-new/season-new' }); }
});
