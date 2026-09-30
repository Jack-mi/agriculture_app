const store = require('../../utils/store.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');
const weather = require('../../utils/weather.js');

Page({
  data: {
    plots: [], plotId: '', crops: C.CROPS, crop: 'wheat',
    sowDate: '', today: '', seedRate: '', tillage: '',
    tillageQuick: ['旋耕', '深翻', '深松', '免耕', '秸秆还田'],
    busyPlots: {}
  },

  onLoad(q) {
    const plots = store.plots.all();
    const busy = {};
    plots.forEach(p => { if (store.seasons.current(p.id)) busy[p.id] = true; });
    const free = plots.find(p => !busy[p.id]);
    // 按月份猜作物：8-12 月默认小麦（秋播），5-7 月默认玉米（夏播）
    const m = new Date().getMonth() + 1;
    this.setData({
      plots, busyPlots: busy,
      plotId: q.plotId || (free ? free.id : (plots[0] ? plots[0].id : '')),
      crop: (m >= 5 && m <= 7) ? 'corn' : 'wheat',
      sowDate: U.today(), today: U.today()
    });
    if (!plots.length) {
      wx.showModal({ title: '还没有地块', content: '先添加一块地再开季', showCancel: false, success: () => wx.redirectTo({ url: '/pages/plot-edit/plot-edit' }) });
    }
  },

  pickPlot(e) { this.setData({ plotId: e.currentTarget.dataset.id }); },
  pickCrop(e) {
    const c = C.cropOf(e.currentTarget.dataset.key);
    if (!c.enabled) return U.toast(c.name + '后续开放');
    this.setData({ crop: c.key });
  },
  onDate(e) { this.setData({ sowDate: e.detail.value }); },
  onSeed(e) { this.setData({ seedRate: e.detail.value }); },
  onTill(e) { this.setData({ tillage: e.detail.value }); },
  addTill(e) {
    const w = e.currentTarget.dataset.w;
    const t = this.data.tillage;
    this.setData({ tillage: t ? (t.indexOf(w) >= 0 ? t : t + '、' + w) : w });
  },

  save() {
    const d = this.data;
    if (!d.plotId) return U.toast('请选择地块');
    if (d.busyPlots[d.plotId]) {
      return wx.showModal({ title: '这块地还有一季没收', content: '请先在那一季里登记收获，再开新一季。', showCancel: false });
    }
    const s = store.seasons.save({
      plotId: d.plotId, crop: d.crop, sowDate: d.sowDate,
      seedRate: d.seedRate ? parseFloat(d.seedRate) : '', tillage: d.tillage.trim(), status: 'growing'
    });
    weather.fillSeason(s).catch(() => null);
    U.toast('开季成功', 'success');
    setTimeout(() => wx.redirectTo({ url: '/pages/season/season?id=' + s.id }), 500);
  }
});
