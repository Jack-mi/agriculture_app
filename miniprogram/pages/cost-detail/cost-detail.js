// 一笔账的详情（F8）：怎么算的 / 分摊到哪 / 结款 / 备注 / 附件，从这儿去编辑或删除
// 说明：操作留痕（costs[i].audit）仍在写数据（回收站/审计口径用），但按用户要求不在界面上展示
const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');
const attach = require('../../utils/attach.js');

Page({
  data: { id: '', c: {}, allocs: [], allocText: '', atts: [], debt: null, pending: 0, log: null, noteOpen: false, noteDraft: '' },

  onLoad(q) { if (q.id) this.setData({ id: q.id }); },
  onShow() { this.render(); },

  render() {
    const c = store.costs.get(this.data.id);
    if (!c || c.deletedAt) { wx.navigateBack(); return; }
    const inc = store.isIncome(c);
    const allocs = store.costs.allocOf(c).map(a => {
      const s = store.seasons.get(a.seasonId);
      const p = s && store.plots.get(s.plotId);
      return {
        seasonId: a.seasonId, amount: U.money(a.amount),
        name: p ? p.name : '（季已删除）', crop: s ? C.cropOf(s.crop).name : '', year: s ? stats.seasonYearLabel(s) : ''
      };
    });
    const debt = c.debt ? {
      party: c.debt.party, settled: c.debt.settled === true,
      dueText: c.debt.dueDate ? U.cnDate(c.debt.dueDate) : (c.debt.dueTag || '不约定'),
      paidText: c.debt.paidAmount ? U.money(c.debt.paidAmount) : '',
      open: !c.debt.settled
    } : null;
    const log = c.logId ? store.logs.get(c.logId) : null;
    this.setData({
      c: {
        id: c.id, inc, dateText: U.cnDate(c.date) + ' ' + U.weekday(c.date),
        catName: C.catOf(c.cat).name, sub: c.sub || '', note: c.note || '',
        icon: C.iconOf(c.sub, c.cat, 'w'),
        amount: U.money(store.allocTotal(c)), calc: stats.calcText(c),
        shared: allocs.length > 1, expr: c.expr || ''
      },
      allocs, allocText: allocs.length > 1 ? '按' + ((C.SPLIT_MODES.find(m => m.key === c.split) || {}).name || '手动') + '分摊' : '',
      debt, log: log ? { id: log.id, text: (log.ops || []).join('、') || log.text || '记事', date: U.cnDate(log.date) } : null,
      atts: (c.attachments || []).map(a => ({ name: a.name || '照片', src: a.fileID || a.localPath, uploaded: !!a.fileID, pending: !a.fileID && !!a.localPath })),
      pending: attach.pendingCount(c)
    });
  },

  edit() { wx.navigateTo({ url: '/pages/cost-edit/cost-edit?id=' + this.data.id }); },
  noop() {},
  // 备注就在这一页改：开弹层 → 保存回写（不跳「记一笔」）
  openNote() { this.setData({ noteOpen: true, noteDraft: this.data.c.note || '' }); },
  closeNote() { this.setData({ noteOpen: false }); },
  onNoteDraft(e) { this.setData({ noteDraft: e.detail.value }); },
  saveNote() {
    const c = store.costs.get(this.data.id);
    if (!c) { this.setData({ noteOpen: false }); return; }
    const note = (this.data.noteDraft || '').trim();
    // 传副本，store.costs.save 才拿得到"旧值"做留痕比对（留痕只在数据里，界面不展示）
    store.costs.save(Object.assign({}, c, { note }));
    this.setData({ noteOpen: false, noteDraft: note });
    U.toast('备注保存了');
    this.render();
  },
  openAtt(e) {
    const a = this.data.atts[e.currentTarget.dataset.i];
    if (a && a.src) wx.previewImage({ urls: this.data.atts.map(x => x.src).filter(Boolean), current: a.src });
  },
  goLog() { wx.navigateTo({ url: '/pages/log-edit/log-edit?id=' + this.data.log.id }); },
  goDebt() { wx.navigateTo({ url: '/pages/debt/debt?dir=' + (this.data.c.inc ? 'in' : 'out') }); },
  retryUpload() {
    attach.flush(this.data.id).then(n => { U.toast(n ? '传上去 ' + n + ' 张' : '还没传成功，联网后自动重试'); this.render(); });
  },
  del() {
    store.costs.remove(this.data.id);
    U.toast('已删除，可在「我的 → 回收站」恢复');
    setTimeout(() => wx.navigateBack(), 450);
  }
});
