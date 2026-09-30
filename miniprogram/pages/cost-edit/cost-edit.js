const store = require('../../utils/store.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');
const stats = require('../../utils/stats.js');

Page({
  data: {
    id: '', seasonId: '', logId: '', cats: C.COST_CATS, cat: 'agri', subs: [], sub: '',
    date: '', today: '', people: '', unitPrice: '', note: '', isEdit: false, seasonLabel: '',
    seasonOpts: [], allocs: [], total: '0'
  },

  onLoad(q) {
    // 全部种植季都可参与分摊（未开季地块需先创建种植季）
    const seasonOpts = store.seasons.all().map(s => {
      const plot = store.plots.get(s.plotId) || {};
      return { id: s.id, label: (plot.name || '未命名地块') + ' · ' + C.cropOf(s.crop).name + ' ' + stats.seasonYearLabel(s) };
    });
    this.setData({ seasonOpts });
    let s;
    if (q.id) {
      const c = store.costs.get(q.id);
      if (!c) return wx.navigateBack();
      s = store.seasons.get(c.seasonId);
      this.setData({
        id: c.id, seasonId: c.seasonId, logId: c.logId || '', cat: c.cat, subs: this.subsOf(c.cat, c.sub), sub: c.sub,
        date: c.date, people: c.people ? String(c.people) : '',
        unitPrice: c.unitPrice ? String(c.unitPrice) : '', note: c.note || '', isEdit: true,
        allocs: store.costs.allocOf(c).map(a => this.allocRow(a.seasonId, String(a.amount)))
      });
      wx.setNavigationBarTitle({ title: '修改账目' });
    } else {
      s = store.seasons.get(q.seasonId);
      const cat = q.cat || 'agri';
      this.setData({
        seasonId: q.seasonId, logId: q.logId || '', cat, subs: this.subsOf(cat, q.sub ? decodeURIComponent(q.sub) : ''),
        sub: q.sub ? decodeURIComponent(q.sub) : (store.tags.cost(cat)[0] || ''), date: q.date || U.today(), note: q.note ? decodeURIComponent(q.note) : '',
        allocs: [this.allocRow(q.seasonId, '')]
      });
    }
    const plot = s && store.plots.get(s.plotId);
    this.setData({ today: U.today(), seasonLabel: plot ? plot.name + ' · ' + C.cropOf(s.crop).name : '', seasonOpts });
    this.recalc();
  },

  allocRow(seasonId, amount) {
    const opt = this.data.seasonOpts.find(o => o.id === seasonId) || {};
    return { seasonId, seasonLabel: opt.label || '未知种植季', amount: amount || '' };
  },
  recalc() {
    const total = this.data.allocs.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    this.setData({ total: U.money(Math.round(total * 100) / 100) });
  },
  addAlloc() {
    const used = this.data.allocs.map(a => a.seasonId);
    const opt = this.data.seasonOpts.find(o => used.indexOf(o.id) < 0);
    if (!opt) return U.toast('没有更多种植季可分摊');
    this.setData({ allocs: this.data.allocs.concat([this.allocRow(opt.id, '')]) });
  },
  delAlloc(e) {
    const list = this.data.allocs.slice();
    list.splice(e.currentTarget.dataset.i, 1);
    this.setData({ allocs: list });
    this.recalc();
  },
  pickAllocSeason(e) {
    const i = e.currentTarget.dataset.i;
    const opt = this.data.seasonOpts[+e.detail.value];
    if (this.data.allocs.some((a, j) => j !== i && a.seasonId === opt.id)) return U.toast('这一季已在分摊里');
    this.setData({ ['allocs[' + i + '].seasonId']: opt.id, ['allocs[' + i + '].seasonLabel']: opt.label });
  },
  onAllocAmount(e) {
    this.setData({ ['allocs[' + e.currentTarget.dataset.i + '].amount']: e.detail.value });
    this.recalc();
  },

  // 细分类型 = 用户自定义列表；编辑旧记录时若其类型已被删除，临时补回显示
  subsOf(cat, keep) {
    const list = store.tags.cost(cat).slice();
    if (keep && list.indexOf(keep) < 0) list.push(keep);
    return list;
  },
  pickCat(e) {
    const cat = e.currentTarget.dataset.k;
    const subs = this.subsOf(cat);
    this.setData({ cat, subs, sub: subs[0] || '' });
  },
  // ＋ 自定义类型：就地新增并选中
  addSub() {
    const cat = this.data.cat;
    wx.showModal({
      title: '新增「' + C.catOf(cat).name + '」类型', editable: true, placeholderText: '如：有机肥、叶面肥',
      success: r => {
        if (!r.confirm) return;
        const name = (r.content || '').trim();
        if (!name) return U.toast('请输入类型名称');
        if (!store.tags.addCost(cat, name) && store.tags.cost(cat).indexOf(name) < 0) return U.toast('添加失败');
        this.setData({ subs: this.subsOf(cat), sub: name });
      }
    });
  },
  manageTags() { wx.navigateTo({ url: '/pages/tags/tags?tab=cost&cat=' + this.data.cat }); },
  onShow() { if (this.data.cat) this.setData({ subs: this.subsOf(this.data.cat, this.data.sub) }); },
  pickSub(e) { this.setData({ sub: e.currentTarget.dataset.s }); },
  onDate(e) { this.setData({ date: e.detail.value }); },
  onNote(e) { this.setData({ note: e.detail.value }); },
  // 雇工：人数 × 日工价 自动算金额
  onPeople(e) { this.setData({ people: e.detail.value }); this.calcLabor(); },
  onUnit(e) { this.setData({ unitPrice: e.detail.value }); this.calcLabor(); },
  calcLabor() {
    const n = parseFloat(this.data.people), p = parseFloat(this.data.unitPrice);
    if (n > 0 && p > 0 && this.data.allocs.length === 1) {
      this.setData({ 'allocs[0].amount': String(Math.round(n * p * 100) / 100) });
      this.recalc();
    }
  },

  save(e) {
    const again = e && e.currentTarget.dataset.again;
    const d = this.data;
    const allocations = d.allocs
      .map(a => ({ seasonId: a.seasonId, amount: parseFloat(a.amount) || 0 }))
      .filter(a => a.seasonId && a.amount > 0);
    if (!allocations.length) return U.toast('至少填一笔分摊金额');
    store.costs.save({
      id: d.id || undefined, seasonId: d.seasonId, logId: d.logId, date: d.date, cat: d.cat, sub: d.sub, allocations,
      people: d.cat === 'labor' && d.people ? parseFloat(d.people) : '',
      unitPrice: d.cat === 'labor' && d.unitPrice ? parseFloat(d.unitPrice) : '',
      note: d.note.trim()
    });
    U.toast('记好了', 'success');
    if (again) {
      this.setData({ allocs: d.allocs.map(a => Object.assign({}, a, { amount: '' })), note: '', people: '', unitPrice: '', total: '0' });
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
