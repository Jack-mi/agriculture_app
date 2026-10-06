// 周期账 / 分期：到日子只生成待记，确认后才落账
const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');
const R = require('../../utils/rec.js');

const FREQS = R.FREQS;
const DIRS = [{ k: 'out', n: '支出' }, { k: 'in', n: '收入' }];
const TAGS = C.DUE_TAGS;

Page({
  data: {
    freqs: FREQS, dirs: DIRS, dueTags: TAGS, today: '',
    list: [], due: [], empty: true,
    weekDays: R.WEEK_DAYS, monthOpts: R.MONTH_OPTS, dayOpts: R.DAY_OPTS,
    editNeedMonth: false, editRule: '', editNext: '',
    sheet: '', edit: null, costCats: C.COST_CATS, incomeCats: C.INCOME_CATS, subList: []
  },
  onLoad() { this.setData({ today: U.today() }); },
  onShow() { this.render(); },

  render() {
    const today = U.today();
    const list = store.recurring.items().map(r => {
      const cat = C.catOf(r.cat);
      return Object.assign({}, r, {
        catName: cat.name, color: cat.color,
        dirName: r.dir === 'in' ? '收入' : '支出',
        freqName: (FREQS.find(f => f.k === r.freq) || {}).n || '每月',
        amountText: r.mode === 'fixed' ? U.money(r.amount)
          : U.money(r.unitPrice) + (r.mode === 'perMu' ? '/亩' : r.mode === 'perJin' ? '/斤' : '/人·天'),
        dueText: r.lastFiredAt ? '最近生成 ' + r.lastFiredAt : '还没生成过',
        dayText: R.dayText(r),
        installmentText: r.installment ? ('分 ' + r.installment.periods + ' 期 · 第 ' + r.installment.index + ' 期') : ''
      });
    });
    const due = stats.recurringDue(today);
    this.setData({ list, due, empty: !list.length });
  },

  openNew() {
    const sub = (store.tags.cost('asset')[0] || '');
    this.setData({
      sheet: 'edit',
      edit: { id: '', name: '', dir: 'out', cat: 'asset', sub, mode: 'fixed', amount: '', unitPrice: '', freq: 'month', day: 1, month: U.parse(U.today()).getMonth() + 1, dueTag: '不约定', startAt: U.today(), endAt: '', enabled: true, installTotal: '', installPeriods: '' },
      subList: store.tags.cost('asset').slice()
    });
    this.editView();
  },
  openEdit(e) {
    const r = store.recurring.get(e.currentTarget.dataset.id);
    if (!r) return;
    this.setData({
      sheet: 'edit',
      edit: Object.assign({ amount: '', unitPrice: '', installTotal: '', installPeriods: '' }, r, { month: R.anchorMonth(r) }),
      subList: r.dir === 'in' ? store.tags.income() : store.tags.cost(r.cat).slice()
    });
    this.editView();
  },
  closeSheet() { this.setData({ sheet: '', edit: null }); },
  noop() {},
  onField(e) { this.setData({ ['edit.' + e.currentTarget.dataset.k]: e.detail.value }); },
  // 「多久一次」下面那行要填什么，随频率变：周几 / 几号 / 哪个月 + 几号
  editView() {
    const e = this.data.edit || {};
    this.setData({
      editNeedMonth: R.NEED_MONTH(e.freq),
      editRule: R.ruleText(e),
      editNext: R.nextText(Object.assign({}, e, { startAt: e.startAt || this.data.today }))
    });
  },
  pickFreq(e) {
    const freq = e.currentTarget.dataset.k;
    const patch = { 'edit.freq': freq };
    if (R.NEED_MONTH(freq) && !R.NEED_MONTH(this.data.edit.freq)) {
      patch['edit.month'] = U.parse(this.data.edit.startAt || this.data.today).getMonth() + 1;
    }
    this.setData(patch);
    this.editView();
  },
  pickDay(e) { this.setData({ 'edit.day': +e.currentTarget.dataset.d }); this.editView(); },
  pickDayIdx(e) { this.setData({ 'edit.day': (+e.detail.value || 0) + 1 }); this.editView(); },
  pickMonthIdx(e) { this.setData({ 'edit.month': (+e.detail.value || 0) + 1 }); this.editView(); },
  pickDir(e) {
    const dir = e.currentTarget.dataset.k;
    const cat = dir === 'in' ? C.INCOME_CATS[0].key : 'asset';
    this.setData({
      'edit.dir': dir, 'edit.cat': cat,
      'edit.sub': dir === 'in' ? (store.tags.income()[0] || '') : (store.tags.cost(cat)[0] || ''),
      'edit.mode': dir === 'in' ? 'fixed' : 'fixed',
      subList: dir === 'in' ? store.tags.income().slice() : store.tags.cost(cat).slice()
    });
  },
  pickCat(e) {
    const cat = e.currentTarget.dataset.k;
    const list = this.data.edit.dir === 'in' ? store.tags.income() : store.tags.cost(cat);
    this.setData({ 'edit.cat': cat, 'edit.sub': list[0] || '', subList: list.slice() });
  },
  pickSub(e) { this.setData({ 'edit.sub': e.currentTarget.dataset.n }); },
  pickMode(e) { this.setData({ 'edit.mode': e.currentTarget.dataset.k }); },
  pickTag(e) { this.setData({ 'edit.dueTag': e.currentTarget.dataset.n }); },
  onDate(e) { this.setData({ ['edit.' + e.currentTarget.dataset.k]: e.detail.value }); this.editView(); },
  toggleEnabled() { this.setData({ 'edit.enabled': !this.data.edit.enabled }); },

  save() {
    const e = this.data.edit;
    if (!(e.name || '').trim()) return U.toast('起个名字，如「土地流转」');
    if (e.mode === 'fixed' && !(parseFloat(e.amount) > 0)) return U.toast('填每期金额');
    if (e.mode !== 'fixed' && !(parseFloat(e.unitPrice) > 0)) return U.toast('填单价');
    const rec = {
      id: e.id || undefined, name: e.name.trim(), dir: e.dir, cat: e.cat, sub: e.sub || '', mode: e.mode,
      amount: parseFloat(e.amount) || 0, unitPrice: parseFloat(e.unitPrice) || 0,
      freq: e.freq, day: +e.day || 1,
      // 季 / 年必须记住落在哪个月，否则等于每次都在 1 月提醒
      month: R.NEED_MONTH(e.freq) ? (e.month || 1) : undefined,
      dueTag: e.dueTag, startAt: e.startAt, endAt: e.endAt || '',
      enabled: e.enabled !== false
    };
    const periods = parseInt(e.installPeriods, 10);
    if (periods > 1) {
      const total = parseFloat(e.installTotal) || 0;
      if (!(total > 0)) return U.toast('填分期总额');
      rec.installment = { total, periods, index: 1 };
      rec.amount = Math.round(total / periods * 100) / 100;
    }
    store.recurring.save(rec);
    U.toast(e.id ? '改好了' : '存好了', 'success');
    this.setData({ sheet: '', edit: null });
    this.render();
  },
  remove(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删掉这个周期账', content: '已生成的账目不受影响，只是以后不再提醒。',
      confirmText: '删掉', confirmColor: '#B3372B',
      success: r => { if (r.confirm) { store.recurring.remove(id); this.render(); } }
    });
  },
  // 到期 → 直接带参进记一笔（金额分类已填好），确认后标记本期已生成
  record(e) {
    const id = e.currentTarget.dataset.id;
    const r = store.recurring.get(id);
    if (!r) return;
    store.recurring.fire(id, U.today());
    wx.navigateTo({ url: '/pages/cost-edit/cost-edit?recurring=' + id });
    this.render();
  },
  recordNow(e) { this.record(e); },
  goDebt() { wx.navigateTo({ url: '/pages/debt/debt' }); }
});
