const store = require('../../utils/store.js');
const U = require('../../utils/util.js');

Page({
  data: { counts: {}, yearCost: '', yearLabel: '' },

  onShow() {
    const d = store.db();
    const y = String(new Date().getFullYear());
    let yc = 0;
    d.costs.forEach(c => { if (c.date.slice(0, 4) === y) yc += c.amount; });
    this.setData({
      counts: { plots: d.plots.length, seasons: d.seasons.length, costs: d.costs.length, logs: d.logs.length },
      yearCost: U.money(yc), yearLabel: y
    });
  },

  goTags() { wx.navigateTo({ url: '/pages/tags/tags' }); },

  about() {
    wx.showModal({
      title: '关于谷雨记',
      content: '谷雨种谷，雨生百谷。记下作物生长的每一场雨、每一天。\n天气数据来自 Open-Meteo 开源天气。',
      showCancel: false
    });
  },

  onShareAppMessage() { return { title: '谷雨记 · 种地记账本，比纸本好用', path: '/pages/index/index' }; }
});
