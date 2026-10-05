// 欠款台账：应收（别人欠我）/ 应付（我欠别人），未结在上，支持部分销账
const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');

const METHODS = ['微信', '现金', '银行转账'];

Page({
  data: { tabs: [{ k: 'in', n: '应收（别人欠我）' }, { k: 'out', n: '应付（我欠别人）' }], tab: 'in', sum: {}, open: [], closed: [], sheet: '', detail: null, methods: METHODS, settle: { amount: '', date: '', method: '微信' } },

  onLoad(q) { if (q && q.dir) this.setData({ tab: q.dir }); },
  onShow() { this.render(); },

  render() {
    const ds = stats.debtSummary();
    const one = this.data.tab === 'in' ? ds.receivable : ds.payable;
    const rows = one.rows.map(r => Object.assign({}, r, {
      remainText: U.money(r.remain), paidText: r.paidAmount ? U.money(r.paidAmount) : '',
      sub: r.sub || '', party: (r.debt && r.debt.party) || '未填对方',
      dateText: U.cnDate(r.date),
      kindText: r.kind
    }));
    this.setData({
      sum: {
        total: U.money(one.total), count: one.count, overdue: one.overdueCount,
        dirName: this.data.tab === 'in' ? '应收' : '应付'
      },
      open: rows.filter(r => !r.settled),
      closed: rows.filter(r => r.settled)
    });
  },

  setTab(e) { this.setData({ tab: e.currentTarget.dataset.k }); this.render(); },
  addDebt() { wx.navigateTo({ url: '/pages/cost-edit/cost-edit?debt=1' }); },
  goCost(e) { wx.navigateTo({ url: '/pages/cost-edit/cost-edit?id=' + e.currentTarget.dataset.id }); },

  openDetail(e) {
    const id = e.currentTarget.dataset.id;
    const c = store.costs.get(id);
    if (!c) return;
    const d = c.debt || {};
    const amount = store.allocTotal(c);
    const remain = Math.round((amount - (+d.paidAmount || 0)) * 100) / 100;
    const allocs = store.costs.allocOf(c);
    const plots = [];
    allocs.forEach(a => { const s = store.seasons.get(a.seasonId); const p = s && store.plots.get(s.plotId); if (p && p.name && plots.indexOf(p.name) < 0) plots.push(p.name); });
    this.setData({
      sheet: 'detail',
      detail: {
        id, amountText: U.money(amount), remain, remainText: U.money(remain),
        paidText: d.paidAmount ? U.money(d.paidAmount) : '',
        party: d.party || '未填对方', dueText: d.dueDate ? U.cnDate(d.dueDate) : (d.dueTag || '不约定'),
        overdue: !!(d.dueDate && d.dueDate < U.today() && !d.settled),
        settled: d.settled === true, dateText: U.cnDate(c.date), note: c.note || '',
        kindText: C.catOf(c.cat).name + (c.sub ? ' · ' + c.sub : ''), plot: plots.join('、'),
        attachments: (c.attachments || []).length, paid: +d.paidAmount || 0
      },
      settle: { amount: String(remain), date: U.today(), method: '微信' }
    });
  },
  closeSheet() { this.setData({ sheet: '', detail: null }); },
  noop() {},
  onSettleAmt(e) { this.setData({ 'settle.amount': e.detail.value }); },
  onSettleDate(e) { this.setData({ 'settle.date': e.detail.value }); },
  pickMethod(e) { this.setData({ 'settle.method': e.currentTarget.dataset.m }); },
  doSettle() {
    const d = this.data.detail, s = this.data.settle;
    if (!(parseFloat(s.amount) > 0)) return U.toast('填一下销账金额');
    store.costs.settle(d.id, { amount: parseFloat(s.amount), date: s.date, method: s.method });
    U.toast('已销账', 'success');
    this.setData({ sheet: '', detail: null });
    this.render();
  },
  urge() {
    const d = this.data.detail;
    const text = d.party + ' 您好，' + d.kindText + ' 的 ¥' + d.remainText + '（约定 ' + d.dueText + '）还没结，方便的时候结一下，谢谢。';
    wx.setClipboardData({ data: text, success: () => U.toast('催款文案已复制，粘到微信发过去') });
  }
});
