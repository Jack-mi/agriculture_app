const store = require('../../utils/store.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');

Page({
  data: {
    id: '', seasonId: '', logId: '', cats: C.COST_CATS, cat: 'agri', subs: C.COST_CATS[0].subs, sub: '种子',
    date: '', today: '', amount: '', people: '', unitPrice: '', note: '', isEdit: false, seasonLabel: ''
  },

  onLoad(q) {
    let s;
    if (q.id) {
      const c = store.costs.get(q.id);
      if (!c) return wx.navigateBack();
      s = store.seasons.get(c.seasonId);
      this.setData({
        id: c.id, seasonId: c.seasonId, logId: c.logId || '', cat: c.cat, subs: C.catOf(c.cat).subs, sub: c.sub,
        date: c.date, amount: String(c.amount), people: c.people ? String(c.people) : '',
        unitPrice: c.unitPrice ? String(c.unitPrice) : '', note: c.note || '', isEdit: true
      });
      wx.setNavigationBarTitle({ title: '修改账目' });
    } else {
      s = store.seasons.get(q.seasonId);
      const cat = q.cat || 'agri';
      this.setData({
        seasonId: q.seasonId, logId: q.logId || '', cat, subs: C.catOf(cat).subs,
        sub: q.sub || C.catOf(cat).subs[0], date: q.date || U.today(), note: q.note ? decodeURIComponent(q.note) : ''
      });
    }
    const plot = s && store.plots.get(s.plotId);
    this.setData({ today: U.today(), seasonLabel: plot ? plot.name + ' · ' + C.cropOf(s.crop).name : '' });
  },

  pickCat(e) {
    const cat = e.currentTarget.dataset.k;
    const subs = C.catOf(cat).subs;
    this.setData({ cat, subs, sub: subs[0] });
  },
  pickSub(e) { this.setData({ sub: e.currentTarget.dataset.s }); },
  onDate(e) { this.setData({ date: e.detail.value }); },
  onAmount(e) { this.setData({ amount: e.detail.value }); },
  onNote(e) { this.setData({ note: e.detail.value }); },
  // 雇工：人数 × 日工价 自动算金额
  onPeople(e) { this.setData({ people: e.detail.value }); this.calcLabor(); },
  onUnit(e) { this.setData({ unitPrice: e.detail.value }); this.calcLabor(); },
  calcLabor() {
    const n = parseFloat(this.data.people), p = parseFloat(this.data.unitPrice);
    if (n > 0 && p > 0) this.setData({ amount: String(Math.round(n * p * 100) / 100) });
  },

  save(e) {
    const again = e && e.currentTarget.dataset.again;
    const d = this.data;
    const amount = parseFloat(d.amount);
    if (!(amount > 0)) return U.toast('请填写金额');
    store.costs.save({
      id: d.id || undefined, seasonId: d.seasonId, logId: d.logId, date: d.date, cat: d.cat, sub: d.sub, amount,
      people: d.cat === 'labor' && d.people ? parseFloat(d.people) : '',
      unitPrice: d.cat === 'labor' && d.unitPrice ? parseFloat(d.unitPrice) : '',
      note: d.note.trim()
    });
    U.toast('记好了', 'success');
    if (again) {
      this.setData({ amount: '', note: '', people: '', unitPrice: '' });
    } else {
      setTimeout(() => wx.navigateBack(), 450);
    }
  },

  del() {
    wx.showModal({
      title: '删除这笔账', confirmText: '删除', confirmColor: '#B3372B',
      success: r => { if (r.confirm) { store.costs.remove(this.data.id); wx.navigateBack(); } }
    });
  }
});
