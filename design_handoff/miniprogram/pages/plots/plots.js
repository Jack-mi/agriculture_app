const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const C = require('../../utils/const.js');

Page({
  data: { list: [], totalArea: 0 },

  onShow() {
    let totalArea = 0;
    const list = store.plots.all().map(p => {
      totalArea += +p.area || 0;
      const ss = store.seasons.byPlot(p.id);
      const cur = ss.find(s => s.status === 'growing');
      return {
        id: p.id, name: p.name, area: p.area, address: p.address || '',
        hasLoc: p.lat !== undefined && p.lat !== '' && p.lat !== null,
        cur: cur ? stats.seasonBrief(cur) : null,
        history: ss.filter(s => s.status === 'done').map(s => {
          const b = stats.seasonBrief(s);
          return { id: s.id, label: b.yearLabel + ' ' + b.crop, cost: b.costText, gdd: b.gdd, rain: b.rain, yieldJin: s.yieldJin };
        })
      };
    });
    this.setData({ list, totalArea: Math.round(totalArea * 10) / 10 });
  },

  addPlot() { wx.navigateTo({ url: '/pages/plot-edit/plot-edit' }); },
  editPlot(e) { wx.navigateTo({ url: '/pages/plot-edit/plot-edit?id=' + e.currentTarget.dataset.id }); },
  goSeason(e) { wx.navigateTo({ url: '/pages/season/season?id=' + e.currentTarget.dataset.id }); },
  newSeason(e) { wx.navigateTo({ url: '/pages/season-new/season-new?plotId=' + e.currentTarget.dataset.id }); }
});
