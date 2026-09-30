const store = require('../../utils/store.js');
const sync = require('../../utils/sync.js');
const stats = require('../../utils/stats.js');
const U = require('../../utils/util.js');

Page({
  data: { counts: {}, sync: {}, syncText: '', yearCost: '', yearLabel: '' },

  onShow() {
    const d = store.db();
    const st = sync.status();
    const y = String(new Date().getFullYear());
    let yc = 0;
    d.costs.forEach(c => { if (c.date.slice(0, 4) === y) yc += c.amount; });
    this.setData({
      counts: { plots: d.plots.length, seasons: d.seasons.length, costs: d.costs.length, logs: d.logs.length },
      sync: st,
      syncText: !st.enabled ? '本地模式 · 数据存在这部手机里' :
        (st.dirty ? '有新记录待同步（联网后自动）' : (st.syncedAt ? '已同步 · ' + new Date(st.syncedAt).toLocaleString() : '已开启云备份')),
      yearCost: U.money(yc), yearLabel: y
    });
  },

  syncNow() {
    if (!this.data.sync.enabled) return U.toast('在 app.js 填入云开发环境 ID 即可开启云备份');
    wx.setStorageSync('guyuji_dirty', 1);
    sync.flush().then(() => { this.onShow(); U.toast('已同步'); });
  },

  goTags() { wx.navigateTo({ url: '/pages/tags/tags' }); },

  // 导出：复制为文本，可粘贴到微信发给家人或自己留存
  exportText() {
    const lines = ['【谷雨记 · 数据导出】' + U.today()];
    store.seasons.all().forEach(s => {
      const b = stats.seasonBrief(s);
      const cs = stats.costSummary(s.id);
      lines.push('', '■ ' + b.plotName + ' ' + b.yearLabel + b.crop + '（' + (s.status === 'done' ? '已收获' : '在种') + '）');
      lines.push('播种 ' + s.sowDate + (s.seedRate ? ' · ' + s.seedRate + '斤/亩' : '') + (s.harvestDate ? ' → 收获 ' + s.harvestDate : ''));
      lines.push('积温 ' + b.gdd + '℃·天 · 降雨 ' + b.rain + 'mm' + (s.yieldJin ? ' · 产量 ' + s.yieldJin + '斤' : ''));
      cs.cats.forEach(c => { if (c.total) lines.push('  ' + c.name + '：¥' + c.totalText); });
      lines.push('  合计：¥' + cs.totalText);
    });
    wx.setClipboardData({ data: lines.join('\n'), success: () => U.toast('已复制，可粘贴到微信') });
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
