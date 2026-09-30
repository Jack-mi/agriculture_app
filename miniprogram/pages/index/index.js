const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const weather = require('../../utils/weather.js');
const U = require('../../utils/util.js');

Page({
  data: { todayText: '', week: '', cards: [], hasPlots: false, online: true, loadingWx: false },

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
    this.setData({
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
  addPlot() { wx.navigateTo({ url: '/pages/plot-edit/plot-edit' }); },
  newSeason() { wx.navigateTo({ url: '/pages/season-new/season-new' }); }
});
