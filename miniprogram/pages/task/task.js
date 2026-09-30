// 任务详情：为什么 · 怎么做 · 依据 · 推荐用药（过登记校验）
// 底部：跟参谋说（带上这条任务）/ 去记一笔（日志预填，保存后任务自动完成）
const store = require('../../utils/store.js');
const advisor = require('../../utils/advisor.js');
const pesticide = require('../../utils/pesticide.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');

Page({
  data: { t: null, prods: [], blocked: [], lvName: '', lvCls: '' },

  onLoad(q) { this.id = decodeURIComponent(q.id || ''); },
  onShow() { this.render(); },

  render() {
    const t = advisor.taskDetail(this.id);
    if (!t) { U.toast('这条任务已不在了'); return setTimeout(() => wx.navigateBack(), 600); }
    const lv = { now: ['马上办', 'red'], week: ['这周', 'org'], later: ['往后', 'gry'], soft: ['提醒', 'gry'] }[t.bucket] || ['', ''];
    const prods = t.target ? pesticide.recommend(t.cropKey, t.target).map(p => Object.assign({}, p, { rateText: p.rate[0] + '–' + p.rate[1] + ' ' + p.unit })) : [];
    const statusText = { done: '已完成', dismissed: '已去掉', expired: '已过期' }[t.status] || '';
    this.setData({ t, prods, blocked: t.target ? pesticide.blocked(t.target) : [], lvName: lv[0], lvCls: lv[1], statusText });
    wx.setNavigationBarTitle({ title: '任务详情' });
  },

  openDoc() {
    const d = this.data.t.doc;
    if (!d) return;
    wx.showModal({ title: d.title, content: d.excerpt + '\n\n—— ' + d.org + ' · ' + d.year, showCancel: false, confirmText: '知道了' });
  },
  talk() { wx.navigateTo({ url: '/pages/chat/chat?taskId=' + encodeURIComponent(this.id) }); },
  // 去记一笔：带上活的类型 + 推荐农资品类 + 面积，进入已有记事页；保存后回调完成任务
  goLog() {
    const t = this.data.t;
    const plot = store.plots.get(t.plotId) || {};
    const q = ['seasonId=' + t.seasonId, 'taskId=' + encodeURIComponent(t.id), 'ops=' + encodeURIComponent((t.ops || []).join(',')),
      'mat=' + encodeURIComponent(t.matType || ''), 'matName=' + encodeURIComponent(this.data.prods[0] ? this.data.prods[0].name : ''),
      'matUnit=' + encodeURIComponent(this.data.prods[0] ? this.data.prods[0].unit : ''), 'mu=' + (plot.area || '')];
    wx.navigateTo({ url: '/pages/log-edit/log-edit?' + q.join('&') });
  },
  reopen() { store.tasks.reopen(this.id); this.render(); U.toast('已放回待办'); }
});
