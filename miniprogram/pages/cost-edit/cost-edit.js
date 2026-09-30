// 记一笔（随手记式一屏录入）
// 金额优先 + 细分图标宫格 + 自绘键盘（可连加）+ 按亩计 / 按人天 + 多季分摊（按亩均摊 / 平均 / 手动）+ 常用账
// 落账口径不变：allocations 为最终金额；calc / expr / split 仅记录"怎么算出来的"
const store = require('../../utils/store.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');
const K = require('../../utils/keypad.js');
const stats = require('../../utils/stats.js');

const LAST_KEY = 'guyuji_last_cat';

Page({
  data: {
    id: '', isEdit: false, logId: '', cats: C.COST_CATS, cat: 'agri', catName: '', catColor: '', sub: '', subs: [],
    modes: C.CALC_MODES, mode: 'fixed', splitModes: C.SPLIT_MODES,
    // 键盘编辑中的字段：amount | price | mu | people
    field: 'amount', amountExpr: '', priceExpr: '', muExpr: '', peopleExpr: '', muTouched: false,
    total: 0, totalText: '0', exprShow: '', kpExpr: '',
    date: '', today: '', dateText: '', note: '',
    seasonOpts: [], picked: [], split: 'area', manual: {}, allocView: [], allocText: '', allocErr: '',
    headLabel: '', subIcon: '',
    sheet: '', noteDraft: '', templates: []
  },

  onLoad(q) {
    const today = U.today();
    const seasonOpts = store.seasons.all().map(s => {
      const p = store.plots.get(s.plotId) || {};
      return { id: s.id, name: (p.name || '未命名地块') + ' · ' + C.cropOf(s.crop).name, sub: stats.seasonYearLabel(s) + (s.variety ? ' · ' + s.variety : '') + (s.status === 'done' ? ' · 已收获' : ''), area: +p.area || 0, cls: C.cropOf(s.crop).cls, icon: C.cropOf(s.crop).icon, growing: s.status === 'growing' };
    });
    this.setData({ seasonOpts, today });

    if (q.id) {
      const c = store.costs.get(q.id);
      if (!c) return wx.navigateBack();
      const allocs = store.costs.allocOf(c);
      const calc = c.calc || (c.cat === 'labor' && c.people && c.unitPrice ? { mode: 'perDay', unitPrice: c.unitPrice, people: c.people } : null);
      const manual = {}; allocs.forEach(a => { manual[a.seasonId] = String(a.amount); });
      this.setData({
        id: c.id, isEdit: true, logId: c.logId || '', cat: c.cat, sub: c.sub, date: c.date, note: c.note || '',
        mode: calc ? calc.mode : 'fixed',
        amountExpr: c.expr || K.fromNumber(c.amount),
        priceExpr: calc ? K.fromNumber(calc.unitPrice) : '',
        muExpr: calc && calc.mu ? K.fromNumber(calc.mu) : '',
        peopleExpr: calc && calc.people ? K.fromNumber(calc.people) : '',
        muTouched: !!(calc && calc.mu),
        field: calc ? 'price' : 'amount',
        picked: allocs.map(a => a.seasonId),
        split: allocs.length > 1 ? (c.split || 'manual') : 'area',
        manual
      });
      wx.setNavigationBarTitle({ title: '修改账目' });
    } else {
      const last = wx.getStorageSync(LAST_KEY) || {};
      const cat = q.cat || last.cat || 'agri';
      const sub = q.sub ? decodeURIComponent(q.sub) : (q.cat ? '' : (last.cat === cat ? last.sub : ''));
      const picked = q.seasonId ? [q.seasonId] : (store.seasons.growing()[0] ? [store.seasons.growing()[0].id] : []);
      const mode = cat === 'labor' ? 'perDay' : (q.mu ? 'perMu' : 'fixed');
      this.setData({
        logId: q.logId || '', cat, sub, date: q.date || today, note: q.note ? decodeURIComponent(q.note) : '',
        picked, mode, field: mode === 'fixed' ? 'amount' : 'price',
        muExpr: q.mu ? K.fromNumber(q.mu) : '', muTouched: !!q.mu
      });
      if (q.tpl) this.applyTemplate(q.tpl);
    }
    this.syncCat();
    this.recalc();
  },

  onShow() { if (this.data.cat) this.syncCat(); },

  // ---------- 分类 ----------
  syncCat() {
    const cat = this.data.cat;
    const list = store.tags.cost(cat).slice();
    let sub = this.data.sub;
    if (sub && list.indexOf(sub) < 0) list.push(sub);
    if (!sub) sub = list[0] || '';
    const c = C.catOf(cat);
    this.setData({
      sub, catName: c.name, catColor: c.color,
      subIcon: C.iconOf(sub, cat, 'w'),
      subs: list.map(n => ({ name: n, icon: C.iconOf(n, cat), iconOn: C.iconOf(n, cat, 'w') }))
    });
  },
  pickCat(e) {
    const cat = e.currentTarget.dataset.k;
    if (cat === this.data.cat) return;
    const patch = { cat, sub: '' };
    // 雇工默认按人天；从雇工切走时回到直接填
    if (cat === 'labor' && this.data.mode !== 'perDay') Object.assign(patch, { mode: 'perDay', field: 'price' });
    else if (cat !== 'labor' && this.data.mode === 'perDay') Object.assign(patch, { mode: 'fixed', field: 'amount' });
    this.setData(patch);
    this.syncCat(); this.recalc();
  },
  pickSub(e) { this.setData({ sub: e.currentTarget.dataset.s, subIcon: C.iconOf(e.currentTarget.dataset.s, this.data.cat, 'w') }); },
  addSub() {
    const cat = this.data.cat;
    wx.showModal({
      title: '新增「' + C.catOf(cat).name + '」类型', editable: true, placeholderText: '如：有机肥、叶面肥',
      success: r => {
        if (!r.confirm) return;
        const name = (r.content || '').trim();
        if (!name) return U.toast('请输入类型名称');
        if (!store.tags.addCost(cat, name) && store.tags.cost(cat).indexOf(name) < 0) return U.toast('添加失败');
        this.setData({ sub: name }); this.syncCat();
      }
    });
  },
  manageTags() { wx.navigateTo({ url: '/pages/tags/tags?tab=cost&cat=' + this.data.cat }); },

  // ---------- 计算方式 & 键盘 ----------
  pickMode(e) {
    const mode = e.currentTarget.dataset.m;
    if (mode === this.data.mode) return;
    const patch = { mode, field: mode === 'fixed' ? 'amount' : 'price' };
    if (mode === 'perMu' && !this.data.muTouched) patch.muExpr = K.fromNumber(store.costs.areaOf(this.data.picked));
    this.setData(patch); this.recalc();
  },
  pickField(e) { this.setData({ field: e.currentTarget.dataset.f }); this.recalc(); },
  fieldKey(f) { return f + 'Expr'; },
  onKey(e) {
    const f = this.data.field;
    const patch = { [this.fieldKey(f)]: e.detail.expr };
    if (f === 'mu') patch.muTouched = true;
    // 按 ＝ 求值后保留原算式，保存时写入 expr
    if (f === 'amount') patch.exprMemo = e.detail.evaluated ? e.detail.from : (K.hasOp(e.detail.expr) ? '' : this.data.exprMemo);
    this.setData(patch); this.recalc();
  },
  onKeyDone() { this.save(false); },
  onKeyAgain() { this.save(true); },

  recalc() {
    const d = this.data;
    const v = x => K.evalExpr(x);
    let total = 0, exprShow = '';
    if (d.mode === 'fixed') {
      total = v(d.amountExpr);
      exprShow = K.hasOp(d.amountExpr) ? d.amountExpr.replace(/\+/g, ' + ').replace(/-/g, ' − ') : '';
    } else if (d.mode === 'perMu') {
      total = Math.round(v(d.priceExpr) * v(d.muExpr) * 100) / 100;
    } else {
      total = Math.round(v(d.priceExpr) * v(d.peopleExpr) * 100) / 100;
    }
    this.setData({
      total, totalText: U.money(total), exprShow,
      kpExpr: d[this.fieldKey(d.field)] || '',
      priceText: d.priceExpr || '0', muText: d.muExpr || '0', peopleText: d.peopleExpr || '0'
    });
    this.recalcAlloc();
  },

  // ---------- 分摊 ----------
  recalcAlloc() {
    const d = this.data;
    const opt = id => d.seasonOpts.find(o => o.id === id) || { name: '未知种植季', area: 0 };
    let allocs;
    if (d.picked.length <= 1) allocs = d.picked.map(id => ({ seasonId: id, amount: d.total }));
    else if (d.split === 'area') allocs = store.costs.allocByArea(d.total, d.picked);
    else if (d.split === 'even') allocs = store.costs.allocEven(d.total, d.picked);
    else allocs = d.picked.map(id => ({ seasonId: id, amount: parseFloat(d.manual[id]) || 0 }));
    const sum = Math.round(allocs.reduce((a, x) => a + x.amount, 0) * 100) / 100;
    const err = d.picked.length > 1 && d.split === 'manual' && d.total > 0 && Math.abs(sum - d.total) > 0.005
      ? (sum < d.total ? '还差 ¥' + U.money(d.total - sum) : '多了 ¥' + U.money(sum - d.total)) : '';
    const splitName = (C.SPLIT_MODES.find(m => m.key === d.split) || {}).name;
    const allocText = !d.picked.length ? '选种植季' : d.picked.length === 1 ? opt(d.picked[0]).name.split(' · ')[0] : d.picked.length + ' 季 · ' + splitName;
    this.setData({
      allocs, allocErr: err, allocText,
      allocView: d.seasonOpts.map(o => {
        const a = allocs.find(x => x.seasonId === o.id);
        return Object.assign({}, o, { on: d.picked.indexOf(o.id) >= 0, amountText: a ? U.money(a.amount) : '', manual: d.manual[o.id] || '' });
      }),
      headLabel: d.picked.length === 1 ? opt(d.picked[0]).name : (d.picked.length ? d.picked.length + ' 个种植季' : '未选种植季'),
      dateText: d.date === d.today ? '今天' : U.cnDate(d.date)
    });
  },
  openAlloc() { this.setData({ sheet: 'alloc' }); },
  toggleSeason(e) {
    const id = e.currentTarget.dataset.id;
    let picked = this.data.picked.slice();
    const i = picked.indexOf(id);
    if (i >= 0) { if (picked.length === 1) return U.toast('至少选一个种植季'); picked.splice(i, 1); }
    else picked.push(id);
    const patch = { picked };
    if (this.data.mode === 'perMu' && !this.data.muTouched) patch.muExpr = K.fromNumber(store.costs.areaOf(picked));
    this.setData(patch); this.recalc();
  },
  pickSplit(e) {
    const split = e.currentTarget.dataset.k;
    const patch = { split };
    // 切到手动：用当前计算结果预填
    if (split === 'manual') { const m = {}; this.data.allocs.forEach(a => { m[a.seasonId] = String(a.amount); }); patch.manual = m; }
    this.setData(patch); this.recalcAlloc();
  },
  onManual(e) { this.setData({ ['manual.' + e.currentTarget.dataset.id]: e.detail.value }); this.recalcAlloc(); },
  closeSheet() {
    if (this.data.sheet === 'alloc' && this.data.allocErr) return U.toast('分摊合计要等于总额：' + this.data.allocErr);
    this.setData({ sheet: '' });
  },
  noop() {},

  // ---------- 日期 / 备注 ----------
  onDate(e) { this.setData({ date: e.detail.value }); this.recalcAlloc(); },
  openNote() { this.setData({ sheet: 'note', noteDraft: this.data.note }); },
  onNoteDraft(e) { this.setData({ noteDraft: e.detail.value }); },
  saveNote() { this.setData({ note: this.data.noteDraft.trim(), sheet: '' }); },

  // ---------- 常用账 ----------
  openTpl() { this.setData({ sheet: 'tpl', templates: this.tplView() }); },
  tplView() {
    return store.tags.templates().map(t => Object.assign({}, t, {
      icon: C.iconOf(t.sub, t.cat), catName: C.catOf(t.cat).name, desc: stats.tplDesc(t)
    }));
  },
  useTpl(e) { this.applyTemplate(e.currentTarget.dataset.id); this.setData({ sheet: '' }); this.syncCat(); this.recalc(); },
  applyTemplate(id) {
    const t = store.tags.template(id);
    if (!t) return;
    const patch = { cat: t.cat, sub: t.sub, mode: t.mode, note: this.data.note || t.note || '' };
    if (t.mode === 'fixed') Object.assign(patch, { amountExpr: K.fromNumber(t.amount), field: 'amount' });
    else Object.assign(patch, { priceExpr: K.fromNumber(t.unitPrice), field: t.mode === 'perMu' ? 'mu' : 'people' });
    if (t.mode === 'perDay' && t.people) patch.peopleExpr = K.fromNumber(t.people);
    if (t.split !== 'current') {
      const growing = store.seasons.growing().map(s => s.id);
      if (growing.length > 1) { patch.picked = growing; patch.split = t.split; }
    }
    if (t.mode === 'perMu' && !this.data.muTouched) patch.muExpr = K.fromNumber(store.costs.areaOf(patch.picked || this.data.picked));
    this.setData(patch);
  },
  saveAsTpl() {
    const d = this.data;
    wx.showModal({
      title: '存为常用账', editable: true, content: d.sub || C.catOf(d.cat).name,
      success: r => {
        if (!r.confirm) return;
        const rec = store.tags.saveTemplate({
          name: r.content, cat: d.cat, sub: d.sub, mode: d.mode,
          unitPrice: K.evalExpr(d.priceExpr), amount: d.mode === 'fixed' ? d.total : 0, people: K.evalExpr(d.peopleExpr),
          split: d.picked.length > 1 ? d.split : 'current', note: d.note
        });
        if (!rec) return U.toast('请填写名称');
        U.toast('已存为常用账');
        this.setData({ templates: this.tplView() });
      }
    });
  },
  goTplManage() { this.setData({ sheet: '' }); wx.navigateTo({ url: '/pages/tags/tags?tab=tpl' }); },

  // ---------- 保存 ----------
  save(again) {
    const d = this.data;
    if (!(d.total > 0)) return U.toast('先输入金额');
    if (!d.picked.length) return U.toast('请选择种植季');
    if (d.allocErr) { this.setData({ sheet: 'alloc' }); return U.toast('分摊合计要等于总额'); }
    const allocations = d.allocs.filter(a => a.amount > 0);
    if (!allocations.length) return U.toast('分摊金额要大于 0');
    const v = x => K.evalExpr(x);
    const calc = d.mode === 'perMu' ? { mode: 'perMu', unitPrice: v(d.priceExpr), mu: v(d.muExpr) }
      : d.mode === 'perDay' ? { mode: 'perDay', unitPrice: v(d.priceExpr), people: v(d.peopleExpr) } : null;
    store.costs.save({
      id: d.id || undefined, seasonId: d.picked[0], logId: d.logId, date: d.date, cat: d.cat, sub: d.sub, allocations,
      calc: calc || undefined,
      expr: d.mode !== 'fixed' ? undefined : K.hasOp(d.amountExpr) ? d.amountExpr : (d.exprMemo && K.evalExpr(d.exprMemo) === d.total ? d.exprMemo : undefined),
      split: d.picked.length > 1 ? d.split : undefined,
      // 兼容旧字段
      people: calc && calc.mode === 'perDay' ? calc.people : '', unitPrice: calc && calc.mode === 'perDay' ? calc.unitPrice : '',
      note: d.note.trim()
    });
    wx.setStorageSync(LAST_KEY, { cat: d.cat, sub: d.sub });
    if (again && !d.isEdit) {
      U.toast('记好了，接着记');
      this.setData({ exprMemo: '', amountExpr: '', priceExpr: d.mode === 'fixed' ? '' : d.priceExpr, peopleExpr: '', note: '', logId: '', field: d.mode === 'fixed' ? 'amount' : 'price' });
      this.recalc();
    } else {
      U.toast('记好了', 'success');
      setTimeout(() => wx.navigateBack(), 450);
    }
  },

  del() {
    wx.showModal({
      title: '删除这笔账', content: '多季共用的账会从所有季里一起删除。', confirmText: '删除', confirmColor: '#B3372B',
      success: r => { if (r.confirm) { store.costs.remove(this.data.id); wx.navigateBack(); } }
    });
  }
});

