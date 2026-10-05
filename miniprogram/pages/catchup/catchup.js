// 连续补账：把「没记事也没记账」的日子一天一屏补完
const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');

const QUICK = ['化肥', '农药', '飞防', '收获', '拉粮', '雇工', '卖粮'];

Page({
  data: { seasonId: '', scopeLabel: '', from: '', to: '', days: [], idx: 0, cur: null, done: 0, total: 0, quick: QUICK, recent: [] },

  onLoad(q) {
    const to = U.today();
    const sid = (q && q.seasonId) || '';
    let from = to.slice(0, 7) + '-01';
    let scopeLabel = '本月至今 · 全部地块';
    if (sid) {
      const s = store.seasons.get(sid);
      if (s) {
        from = s.sowDate > to ? to : s.sowDate;
        scopeLabel = (store.plots.get(s.plotId) || {}).name + ' · ' + C.cropOf(s.crop).name;
      }
    }
    this.setData({ seasonId: sid, from, to, scopeLabel });
    this.refresh();
  },
  onShow() { this.refresh(); },

  missing() {
    return stats.missingDays(this.data.from, this.data.to, this.data.seasonId);
  },

  refresh() {
    const days = this.missing();
    let idx = this.data.idx;
    if (idx >= days.length) idx = 0;
    this.setData({ days, idx, total: days.length, cur: days.length ? this.curView(days[idx]) : null, recent: this.recentView(), done: 0 });
  },

  curView(d) {
    const s = this.data.seasonId ? store.seasons.get(this.data.seasonId) : null;
    return {
      date: d, dateText: U.cnDate(d, true), week: U.weekday(d),
      dayN: s ? U.diffDays(s.sowDate, d) + 1 : 0,
      w: s ? (store.weather.get(s.plotId, d) || null) : null
    };
  },

  recentView() {
    const out = [];
    store.costs.all().slice(0, 3).forEach(c => out.push({
      id: c.id, text: (store.isIncome(c) ? '收 ' : '支 ') + C.catOf(c.cat).name + ' ¥' + U.money(store.allocTotal(c)), date: c.date
    }));
    return out;
  },

  pos() { return (this.data.idx + 1) + ' / ' + this.data.total; },
  next() {
    if (this.data.idx + 1 >= this.data.days.length) {
      U.toast('这几天都看过了', 'success');
      return;
    }
    this.setData({ idx: this.data.idx + 1 });
    this.refresh();
  },
  prev() { if (this.data.idx > 0) { this.setData({ idx: this.data.idx - 1 }); this.refresh(); } },
  exit() { wx.navigateBack(); },

  // 四种动作
  addOut(e) {
    const d = this.data.cur;
    const sub = e && e.currentTarget.dataset.s;
    const q = sub ? '&cat=agri&sub=' + encodeURIComponent(sub) : '';
    if (sub === '卖粮') { wx.navigateTo({ url: '/pages/cost-edit/cost-edit?date=' + d.date + '&cat=grain&dir=in' }); return; }
    wx.navigateTo({ url: '/pages/cost-edit/cost-edit?date=' + d.date + q });
  },
  addIn() { wx.navigateTo({ url: '/pages/cost-edit/cost-edit?date=' + this.data.cur.date + '&dir=in' }); },
  addLog() { wx.navigateTo({ url: '/pages/log-edit/log-edit?date=' + this.data.cur.date + (this.data.seasonId ? '&seasonId=' + this.data.seasonId : '') }); },
  markNone() {
    const d = this.data.cur;
    const sid = this.data.seasonId || (store.seasons.growing()[0] || {}).id;
    if (!sid) return U.toast('先开一个种植季');
    store.setAuditSrc('catchup');
    store.logs.save({ seasonId: sid, date: d.date, ops: [], text: '这天没事', noop: true });
    store.setAuditSrc('local');
    U.toast('记下了，这天不用补');
    this.next();
  }
});
