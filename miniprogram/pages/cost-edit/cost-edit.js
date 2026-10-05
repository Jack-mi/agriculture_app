// 记一笔：支出 / 收入 双态一屏录入
// 金额头 + 最近用过 + 分类 + chip 行（日期/分摊/备注/附件/周期/赊账/常用账）+ 自绘键盘
// 落账口径不变：allocations 为最终金额；calc / expr / split / debt / attachments 只记录"怎么来的"
const store = require('../../utils/store.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');
const K = require('../../utils/keypad.js');
const stats = require('../../utils/stats.js');
const pref = require('../../utils/pref.js');
const attach = require('../../utils/attach.js');

const LAST_KEY = 'guyuji_last_cat';
const PARTY_KEY = 'guyuji_debt_parties';
const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6].map(d => ({ d, n: ['日', '一', '二', '三', '四', '五', '六'][d] }));
const MONTH_DAYS = [1, 5, 10, 15, 20, 25];
// 三种计算方式对应的键盘字段
function fieldOf(mode) {
  if (mode === 'perMu') return 'price';
  if (mode === 'perDay') return 'price';
  if (mode === 'perJin') return 'price';
  if (mode === 'perMuPrice') return 'price';
  return 'amount';
}

function parties() {
  try { return wx.getStorageSync(PARTY_KEY) || []; } catch (e) { return []; }
}
function pushParty(name) {
  name = (name || '').trim();
  if (!name) return parties();
  const list = parties().filter(x => x !== name);
  list.unshift(name);
  const next = list.slice(0, 8);
  try { wx.setStorageSync(PARTY_KEY, next); } catch (e) {}
  return next;
}

Page({
  data: {
    id: '', isEdit: false, logId: '', dir: 'out', dirs: [{ k: 'out', n: '支出' }, { k: 'in', n: '收入' }],
    cats: [], incList: [], cat: 'agri', catName: '', catColor: '', sub: '', subs: [],
    modes: [], mode: 'fixed', splitModes: C.SPLIT_MODES,
    field: 'amount', amountExpr: '', priceExpr: '', muExpr: '', peopleExpr: '', qtyExpr: '', muTouched: false,
    unit: '斤',
    total: 0, totalText: '0', exprShow: '', kpExpr: '',
    date: '', today: '', dateText: '', note: '',
    seasonOpts: [], picked: [], split: 'area', manual: {}, allocView: [], allocText: '', allocErr: '',
    headLabel: '', subIcon: '', iconOn: '',
    sheet: '', noteDraft: '', templates: [], recents: [],
    attachments: [], attSheet: false,
    // 资金账户
    account: '', acctList: [], acctName: '',
    // 赊账
    debt: null, party: '', partyList: [], dueTag: '不约定', dueDate: '',
    // 周期
    rec: null, recFreqs: [{ k: 'week', n: '每周' }, { k: 'month', n: '每月' }, { k: 'quarter', n: '每季' }, { k: 'year', n: '每年' }],
    weekDays: WEEK_DAYS, monthDays: MONTH_DAYS,
    dueTags: C.DUE_TAGS,
    kpPref: {}
  },

  onLoad(q) {
    const today = U.today();
    const seasonOpts = store.seasons.all().map(s => {
      const p = store.plots.get(s.plotId) || {};
      return { id: s.id, name: (p.name || '未命名地块') + ' · ' + C.cropOf(s.crop).name, sub: stats.seasonYearLabel(s) + (s.variety ? ' · ' + s.variety : '') + (s.status === 'done' ? ' · 已收获' : ''), area: +p.area || 0, cls: C.cropOf(s.crop).cls, icon: C.cropOf(s.crop).icon, growing: s.status === 'growing' };
    });
    const kpPref = pref.all();
    this.setData({ seasonOpts, today, kpPref, acctList: store.accounts.items() });

    if (q.id) {
      const c = store.costs.get(q.id);
      if (!c) { wx.navigateBack(); return; }
      const allocs = store.costs.allocOf(c);
      const calc = c.calc || (c.cat === 'labor' && c.people && c.unitPrice ? { mode: 'perDay', unitPrice: c.unitPrice, people: c.people } : null);
      const manual = {}; allocs.forEach(a => { manual[a.seasonId] = String(a.amount); });
      const dir = c.dir === 'in' ? 'in' : 'out';
      this.setData({
        id: c.id, isEdit: true, dir, logId: c.logId || '', cat: c.cat, sub: c.sub, date: c.date, note: c.note || '',
        mode: calc ? calc.mode : 'fixed',
        amountExpr: c.expr || K.fromNumber(c.amount),
        priceExpr: calc ? K.fromNumber(calc.unitPrice) : '',
        muExpr: calc && calc.mu ? K.fromNumber(calc.mu) : '',
        qtyExpr: calc && calc.qty ? K.fromNumber(calc.qty) : '',
        unit: calc && calc.unit ? calc.unit : '斤',
        peopleExpr: calc && calc.people ? K.fromNumber(calc.people) : '',
        muTouched: !!(calc && calc.mu),
        field: fieldOf(calc ? calc.mode : 'fixed'),
        picked: allocs.map(a => a.seasonId),
        split: allocs.length > 1 ? (c.split || 'manual') : 'area',
        attachments: (c.attachments || []).slice(),
        debt: c.debt || null, party: (c.debt && c.debt.party) || '', dueTag: (c.debt && c.debt.dueTag) || '不约定', dueDate: (c.debt && c.debt.dueDate) || '',
        account: c.account || '', acctName: store.accounts.name(c.account),
        manual
      });
      wx.setNavigationBarTitle({ title: '修改账目' });
    } else {
      const dir = q.dir === 'in' ? 'in' : 'out';
      const last = wx.getStorageSync(LAST_KEY) || {};
      const sameDir = (last.dir || 'out') === dir;
      const cat = q.cat || (sameDir ? last.cat : '') || C.catsFor(dir)[0].key;
      const sub = q.sub ? decodeURIComponent(q.sub) : (q.cat ? '' : (sameDir && last.cat === cat ? last.sub : ''));
      const picked = q.seasonId ? [q.seasonId] : (store.seasons.growing()[0] ? [store.seasons.growing()[0].id] : []);
      // 收入类型自带默认算法（卖粮=按斤×价）；支出：雇工默认按人天，带亩数则按亩
      const mode = C.catOf(cat).mode || (dir === 'out' && cat === 'labor' ? 'perDay' : (q.mu ? 'perMu' : 'fixed'));
      this.setData({
        dir, logId: q.logId || '', cat, sub: dir === 'in' ? (sub || store.tags.income()[0] || '卖粮') : sub,
        date: q.date || today, note: q.note ? decodeURIComponent(q.note) : '',
        picked, mode, field: fieldOf(mode),
        muExpr: q.mu ? K.fromNumber(q.mu) : '', muTouched: !!q.mu
      });
      if (q.tpl) this.applyTemplate(q.tpl);
      if (q.recurring) this.applyRecurring(q.recurring);
      if (q.debt) this.setData({ sheet: 'debt' });
    }
    this.syncCat();
    this.recalc();
    this.setData({ partyList: parties() });
  },

  onShow() { if (this.data.cat) { this.syncCat(); this.setData({ kpPref: pref.all(), recents: pref.recentFor(this.data.dir, pref.all().recentCount, pref.all().recentSub) }); } },

  // ---------- 方向 ----------
  pickDir(e) {
    const dir = e.currentTarget.dataset.k;
    if (dir === this.data.dir) return;
    const cat = dir === 'in' ? C.incomeKeyOf(store.tags.income()[0] || '卖粮') : C.COST_CATS[0].key;
    this.setData({
      dir, cat, sub: dir === 'in' ? (store.tags.income()[0] || '卖粮') : '', mode: C.catOf(cat).mode || 'fixed', field: 'amount',
      amountExpr: this.data.amountExpr, priceExpr: '', peopleExpr: '', qtyExpr: ''
    });
    this.setData({ recents: pref.recentFor(dir, this.data.kpPref.recentCount, this.data.kpPref.recentSub) });
    this.syncCat(); this.recalc();
  },

  // ---------- 分类 ----------
  syncCat() {
    const dir = this.data.dir, cat = this.data.cat;
    const c = C.catOf(cat);
    let list, subs = [];
    if (dir === 'in') {
      const names = store.tags.income();
      const cur = (this.data.sub && names.indexOf(this.data.sub) >= 0) ? this.data.sub : (names[0] || '卖粮');
      const key = C.incomeKeyOf(cur);
      this.setData({
        incList: names.map(n => { const k = C.incomeKeyOf(n); return { name: n, key: k, icon: C.iconOf('', k), iconOn: C.iconOf('', k, 'w') }; }),
        cat: key, catName: cur, sub: cur, catColor: C.INCOME_COLOR,
        subIcon: C.iconOf('', key), iconOn: C.iconOf('', key, 'w'),
        cats: C.COST_CATS, subs: []
      });
      return;
    }
    list = store.tags.cost(cat).slice();
    let sub = this.data.sub;
    if (sub && list.indexOf(sub) < 0) list.push(sub);
    if (!sub) sub = list[0] || '';
    this.setData({
      incList: [],
      sub, catName: c.name, catColor: c.color,
      subIcon: C.iconOf(sub, cat), iconOn: C.iconOf(sub, cat, 'w'),
      cats: C.COST_CATS,
      subs: list.map(n => ({ name: n, icon: C.iconOf(n, cat), iconOn: C.iconOf(n, cat, 'w') }))
    });
  },
  pickCat(e) {
    const k = e.currentTarget.dataset.k;
    if (this.data.dir === 'in') return;
    if (k === this.data.cat) return;
    const patch = { cat: k, sub: '' };
    if (k === 'labor' && this.data.mode !== 'perDay') Object.assign(patch, { mode: 'perDay', field: 'price' });
    else if (k !== 'labor' && this.data.mode === 'perDay') Object.assign(patch, { mode: 'fixed', field: 'amount' });
    this.setData(patch);
    this.syncCat(); this.recalc();
  },
  pickIncCat(e) {
    const name = e.currentTarget.dataset.n;
    const key = C.incomeKeyOf(name);
    const mode = (C.INCOME_CATS.find(x => x.key === key) || {}).mode || 'fixed';
    this.setData({ cat: key, sub: name, catName: name, mode, field: fieldOf(mode), subIcon: C.iconOf('', key), iconOn: C.iconOf('', key, 'w') });
    this.recalc();
  },
  pickSub(e) { this.setData({ sub: e.currentTarget.dataset.s, subIcon: C.iconOf(e.currentTarget.dataset.s, this.data.cat), iconOn: C.iconOf(e.currentTarget.dataset.s, this.data.cat, 'w') }); },
  pickRecent(e) {
    const i = e.currentTarget.dataset.i, r = this.data.recents[i];
    if (!r) return;
    if (r.dir === 'in') {
      const name = r.sub || '卖粮';
      const key = C.incomeKeyOf(name);
      const mode = (C.INCOME_CATS.find(x => x.key === key) || {}).mode || 'fixed';
      this.setData({ dir: 'in', cat: key, sub: name, catName: name, mode, field: fieldOf(mode) });
    } else this.setData({ cat: r.cat, sub: r.sub || '' });
    this.syncCat(); this.recalc();
  },
  addSub() {
    const cat = this.data.cat;
    const isIn = this.data.dir === 'in';
    wx.showModal({
      title: isIn ? '新增收入类型' : '新增「' + C.catOf(cat).name + '」类型', editable: true,
      placeholderText: isIn ? '如：青贮、农机服务' : '如：有机肥、叶面肥',
      success: r => {
        if (!r.confirm) return;
        const name = (r.content || '').trim();
        if (!name) return U.toast('请输入名称');
        if (isIn) store.tags.addIncome(name);
        else if (!store.tags.addCost(cat, name) && store.tags.cost(cat).indexOf(name) < 0) return U.toast('添加失败');
        if (isIn) this.setData({ sub: name, catName: name });
        else { this.setData({ sub: name }); }
        this.syncCat();
        this.recalc();
      }
    });
  },
  manageTags() { wx.navigateTo({ url: '/pages/tags/tags?tab=' + (this.data.dir === 'in' ? 'income' : 'cost') + '&cat=' + this.data.cat }); },

  // ---------- 计算方式 & 键盘 ----------
  pickMode(e) {
    const mode = e.currentTarget.dataset.m;
    if (mode === this.data.mode) return;
    const patch = { mode, field: fieldOf(mode) };
    if (mode === 'perMu' && !this.data.muTouched) patch.muExpr = K.fromNumber(store.costs.areaOf(this.data.picked));
    if ((mode === 'perJin' || mode === 'perMuPrice') && !this.data.qtyExpr) {
      const s = store.seasons.get(this.data.picked[0]);
      if (mode === 'perJin' && s && s.yieldJin) patch.qtyExpr = K.fromNumber(s.yieldJin);
      if (mode === 'perMuPrice' && !this.data.muTouched) patch.muExpr = K.fromNumber(store.costs.areaOf(this.data.picked));
    }
    this.setData(patch); this.recalc();
  },
  pickField(e) { this.setData({ field: e.currentTarget.dataset.f }); this.recalc(); },
  fieldKey(f) { return f + 'Expr'; },
  onKey(e) {
    const f = this.data.field;
    const patch = { [this.fieldKey(f)]: e.detail.expr };
    if (f === 'mu') patch.muTouched = true;
    if (f === 'amount') patch.exprMemo = e.detail.evaluated ? e.detail.from : (K.hasOp(e.detail.expr) ? '' : this.data.exprMemo);
    this.setData(patch); this.recalc();
  },
  onKeyDone() { this.save(false); },
  onKeyAgain() { this.save(true); },
  // 键盘左下角那颗可换的功能键（在「我的 → 记账键盘」里设置）
  onKeyFn(e) {
    const k = e.detail.key;
    if (k === 'today') { this.setData({ date: this.data.today }); this.recalcAlloc(); return; }
    if (k === 'tpl') return this.openTpl();
    if (k === 'attach') return this.openAtt();
  },

  recalc() {
    const d = this.data;
    const v = x => K.evalExpr(x);
    let total = 0, exprShow = '';
    if (d.mode === 'fixed') {
      total = v(d.amountExpr);
      exprShow = K.hasOp(d.amountExpr) ? d.amountExpr.replace(/\+/g, ' + ').replace(/-/g, ' − ') : '';
    } else if (d.mode === 'perMu') {
      total = Math.round(v(d.priceExpr) * v(d.muExpr) * 100) / 100;
    } else if (d.mode === 'perJin') {
      total = Math.round(v(d.priceExpr) * v(d.qtyExpr) * 100) / 100;
    } else if (d.mode === 'perMuPrice') {
      total = Math.round(v(d.priceExpr) * v(d.muExpr) * 100) / 100;
    } else {
      total = Math.round(v(d.priceExpr) * v(d.peopleExpr) * 100) / 100;
    }
    this.setData({
      total, totalText: U.money(total), exprShow,
      kpExpr: d[this.fieldKey(d.field)] || '',
      priceText: d.priceExpr || '0', muText: d.muExpr || '0', peopleText: d.peopleExpr || '0', qtyText: d.qtyExpr || '0'
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
    const picked = this.data.picked.slice();
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
    if (split === 'manual') { const m = {}; this.data.allocs.forEach(a => { m[a.seasonId] = String(a.amount); }); patch.manual = m; }
    this.setData(patch); this.recalcAlloc();
  },
  onManual(e) { this.setData({ ['manual.' + e.currentTarget.dataset.id]: e.detail.value }); this.recalcAlloc(); },
  closeSheet() {
    // 关闭就是关闭：不再拦着校验（✕ / 取消 / 点遮罩 都必须能退出）
    this.setData({ sheet: '', debtPending: null });
  },
  noop() {},

  // ---------- 日期 / 备注 ----------
  onDate(e) { this.setData({ date: e.detail.value }); this.recalcAlloc(); },
  openNote() { this.setData({ sheet: 'note', noteDraft: this.data.note }); },
  onNoteDraft(e) { this.setData({ noteDraft: e.detail.value }); },
  saveNote() { this.setData({ note: this.data.noteDraft.trim(), sheet: '' }); },

  // ---------- 附件 ----------
  openAtt() { this.setData({ sheet: 'att' }); },
  addAtt() {
    wx.chooseMedia({
      count: 9 - this.data.attachments.length, mediaType: ['image'], sourceType: ['camera', 'album'], sizeType: ['original'],
      success: r => {
        const list = this.data.attachments.concat((r.tempFiles || []).map(f => ({ name: '照片', localPath: f.tempFilePath, size: f.size })));
        this.setData({ attachments: list.slice(0, 9) });
      }
    });
  },
  delAtt(e) {
    const i = e.currentTarget.dataset.i;
    const list = this.data.attachments.filter((_, k) => k !== i);
    this.setData({ attachments: list });
  },

  // ---------- 赊账 ----------
  openDebt() {
    if (this.data.dir === 'in') this.setData({ debtPending: { kind: 'receive' } });
    else this.setData({ debtPending: { kind: 'pay' } });
    this.setData({ sheet: 'debt', partyList: parties() });
  },
  pickParty(e) {
    const n = e.currentTarget.dataset.n;
    this.setData({ party: this.data.party === n ? '' : n });
  },
  onParty(e) { this.setData({ party: e.detail.value }); },
  pickDueTag(e) { this.setData({ dueTag: e.currentTarget.dataset.n }); },
  onDueDate(e) { this.setData({ dueDate: e.detail.value, dueTag: '不约定' }); },
  confirmDebt() {
    const p = this.data.party.trim();
    if (!p) return U.toast('填一下' + (this.data.dir === 'in' ? '谁欠' : '欠给谁'));
    pushParty(p);
    this.setData({ debt: { party: p, dueTag: this.data.dueDate ? '' : this.data.dueTag, dueDate: this.data.dueDate, settled: false, paidAmount: 0 }, partyList: parties(), sheet: '' });
    U.toast('挂成' + (this.data.dir === 'in' ? '应收' : '应付'));
  },
  clearDebt() { this.setData({ debt: null, party: '', dueTag: '不约定', dueDate: '', sheet: '' }); },

  // ---------- 资金账户 ----------
  openAcct() { this.setData({ sheet: 'acct', acctList: store.accounts.items() }); },
  pickAcct(e) { const k = e.currentTarget.dataset.k; this.setData({ account: k, acctName: store.accounts.name(k), sheet: '' }); },
  clearAcct() { this.setData({ account: '', acctName: '', sheet: '' }); },

  // ---------- 周期账 ----------
  openRec() { this.setData({ sheet: 'rec', rec: this.data.rec || { freq: 'month', day: 1, enabled: true } }); },
  pickFreq(e) { this.setData({ 'rec.freq': e.currentTarget.dataset.k }); },
  pickDay(e) { this.setData({ 'rec.day': +e.currentTarget.dataset.d }); },
  saveRec() {
    const d = this.data;
    if (!(d.total > 0)) return U.toast('先输入金额');
    const name = d.sub || d.catName || C.catOf(d.cat).name;
    store.recurring.save({
      name, dir: d.dir, cat: d.cat, sub: d.sub, mode: d.mode,
      amount: d.mode === 'fixed' ? d.total : 0, unitPrice: K.evalExpr(d.priceExpr),
      freq: d.rec.freq, day: d.rec.day, dueTag: d.dueTag, startAt: d.date, enabled: true
    });
    U.toast('存成周期账了，到日子会提醒');
    this.setData({ sheet: '' });
  },
  applyRecurring(id) {
    const r = store.recurring.get(id);
    if (!r) return;
    const patch = { dir: r.dir, cat: r.cat, sub: r.sub, mode: r.mode, field: fieldOf(r.mode), note: this.data.note || '' };
    if (r.mode === 'fixed') patch.amountExpr = K.fromNumber(r.amount);
    else patch.priceExpr = K.fromNumber(r.unitPrice);
    this.setData(patch);
  },

  // ---------- 常用账 ----------
  openTpl() { this.setData({ sheet: 'tpl', templates: this.tplView() }); },
  tplView() {
    return store.tags.templates().filter(t => (t.dir === 'in' ? 'in' : 'out') === this.data.dir).map(t => Object.assign({}, t, {
      icon: C.iconOf(t.sub, t.cat), catName: C.catOf(t.cat).name, desc: stats.tplDesc(t)
    }));
  },
  useTpl(e) { this.applyTemplate(e.currentTarget.dataset.id); this.setData({ sheet: '' }); this.syncCat(); this.recalc(); },
  applyTemplate(id) {
    const t = store.tags.template(id);
    if (!t) return;
    const dir = t.dir === 'in' ? 'in' : 'out';
    const patch = { dir, cat: t.cat, sub: t.sub, mode: t.mode, field: fieldOf(t.mode), note: this.data.note || t.note || '' };
    if (t.mode === 'fixed') Object.assign(patch, { amountExpr: K.fromNumber(t.amount) });
    else Object.assign(patch, { priceExpr: K.fromNumber(t.unitPrice) });
    if (t.mode === 'perDay' && t.people) patch.peopleExpr = K.fromNumber(t.people);
    if (t.split !== 'current') {
      const growing = store.seasons.growing().map(s => s.id);
      if (growing.length > 1) { patch.picked = growing; patch.split = t.split; }
    }
    if ((t.mode === 'perMu' || t.mode === 'perMuPrice') && !this.data.muTouched) patch.muExpr = K.fromNumber(store.costs.areaOf(patch.picked || this.data.picked));
    this.setData(patch);
  },
  saveAsTpl() {
    const d = this.data;
    wx.showModal({
      title: '存为常用账', editable: true, content: d.sub || d.catName,
      success: r => {
        if (!r.confirm) return;
        const rec = store.tags.saveTemplate({
          name: r.content, dir: d.dir, cat: d.cat, sub: d.sub, mode: d.mode,
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
      : d.mode === 'perDay' ? { mode: 'perDay', unitPrice: v(d.priceExpr), people: v(d.peopleExpr) }
        : d.mode === 'perJin' ? { mode: 'perJin', unitPrice: v(d.priceExpr), qty: v(d.qtyExpr), unit: d.unit }
          : d.mode === 'perMuPrice' ? { mode: 'perMuPrice', unitPrice: v(d.priceExpr), mu: v(d.muExpr) } : null;
    store.setAuditSrc(d.attachments.length ? 'attach' : 'local');
    const saved = store.costs.save({
      id: d.id || undefined, dir: d.dir, seasonId: d.picked[0], logId: d.logId, date: d.date, cat: d.cat, sub: d.sub, allocations,
      calc: calc || undefined,
      expr: d.mode !== 'fixed' ? undefined : K.hasOp(d.amountExpr) ? d.amountExpr : (d.exprMemo && K.evalExpr(d.exprMemo) === d.total ? d.exprMemo : undefined),
      split: d.picked.length > 1 ? d.split : undefined,
      debt: d.debt || undefined,
      account: d.account || undefined,
      attachments: d.attachments.length ? d.attachments : undefined,
      people: calc && calc.mode === 'perDay' ? calc.people : '', unitPrice: calc && calc.mode === 'perDay' ? calc.unitPrice : '',
      note: d.note.trim()
    });
    store.setAuditSrc('local');
    // 附件联网后补传（不阻塞保存，传完回填 fileID）
    if (saved && d.attachments.length) attach.flush(saved.id).catch(() => null);
    wx.setStorageSync(LAST_KEY, { dir: d.dir, cat: d.cat, sub: d.sub });
    pref.pushRecent(d.cat, d.sub, d.dir);
    if (again && !d.isEdit) {
      U.toast('记好了，接着记');
      this.setData({
        exprMemo: '', amountExpr: '', priceExpr: d.mode === 'fixed' ? '' : d.priceExpr, peopleExpr: '', qtyExpr: d.mode === 'perJin' ? '' : this.data.qtyExpr,
        note: '', logId: '', debt: null, attachments: [], field: fieldOf(d.mode)
      });
      this.recalc();
    } else {
      U.toast('记好了', 'success');
      setTimeout(() => wx.navigateBack(), 450);
    }
  },

  del() {
    store.costs.remove(this.data.id);
    U.toast('已删除，可在「我的 → 回收站」恢复');
    setTimeout(() => wx.navigateBack(), 450);
  }
});
