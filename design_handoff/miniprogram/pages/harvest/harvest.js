const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const U = require('../../utils/util.js');

Page({
  data: { id: '', date: '', today: '', sowDate: '', yieldJin: '', note: '', preview: {}, area: 0, perMu: '' },

  onLoad(q) {
    const s = store.seasons.get(q.id);
    if (!s) return wx.navigateBack();
    const plot = store.plots.get(s.plotId) || {};
    this.setData({
      id: s.id, sowDate: s.sowDate, today: U.today(), area: plot.area || 0,
      date: s.harvestDate || U.today(), yieldJin: s.yieldJin ? String(s.yieldJin) : '', note: s.harvestNote || ''
    });
    this.calc();
  },

  calc() {
    const s = Object.assign({}, store.seasons.get(this.data.id), { status: 'done', harvestDate: this.data.date });
    const ws = stats.weatherSeries(s);
    const cs = stats.costSummary(s.id);
    const y = parseFloat(this.data.yieldJin);
    this.setData({
      preview: {
        days: U.diffDays(s.sowDate, this.data.date) + 1, gdd: ws.gdd, rain: ws.rain, missing: ws.missing,
        cost: cs.totalText, costPerJin: y > 0 && cs.total ? (cs.total / y).toFixed(2) : ''
      },
      perMu: y > 0 && this.data.area ? Math.round(y / this.data.area) : ''
    });
  },

  onDate(e) { this.setData({ date: e.detail.value }); this.calc(); },
  onYield(e) { this.setData({ yieldJin: e.detail.value }); this.calc(); },
  onNote(e) { this.setData({ note: e.detail.value }); },

  save() {
    const y = parseFloat(this.data.yieldJin);
    if (!(y > 0)) return U.toast('请填写产量');
    store.seasons.save({ id: this.data.id, status: 'done', harvestDate: this.data.date, yieldJin: y, harvestNote: this.data.note.trim() });
    wx.showModal({
      title: '这一季收官了',
      content: '共 ' + this.data.preview.days + ' 天，积温 ' + this.data.preview.gdd + '℃·天，降雨 ' + this.data.preview.rain + 'mm，总投入 ¥' + this.data.preview.cost,
      showCancel: false, confirmText: '好的',
      success: () => wx.navigateBack()
    });
  }
});
