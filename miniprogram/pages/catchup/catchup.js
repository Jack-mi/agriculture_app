// 连续补账：把「没记事也没记账」的日子一天一屏补完
// 记一笔直接在页内完成（选类型 + 键盘输金额 + 保存），不再二次跳转
const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');
const K = require('../../utils/keypad.js');

const QUICK = ['化肥', '农药', '飞防', '收获', '拉粮', '雇工', '卖粮'];
const QUICK_MAP = {
  化肥: { dir: 'out', cat: 'agri', sub: '化肥' },
  农药: { dir: 'out', cat: 'agri', sub: '农药' },
  飞防: { dir: 'out', cat: 'mach', sub: '飞防' },
  收获: { dir: 'out', cat: 'mach', sub: '收获' },
  拉粮: { dir: 'out', cat: 'trans', sub: '拉粮' },
  雇工: { dir: 'out', cat: 'labor', sub: '按天用工' },
  卖粮: { dir: 'in', cat: 'grain', sub: '卖粮' }
};

Page({
  data: {
    seasonId: '', scopeLabel: '', from: '', to: '', days: [], idx: 0, cur: null, total: 0,
    quick: QUICK,
    dirs: [{ k: 'out', n: '支出' }, { k: 'in', n: '收入' }],
    dir: 'out', cats: [], cat: 'agri', subs: [], sub: '', label: '',
    expr: '', amt: 0, amtText: '0', note: ''
  },

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
    this.syncCats();
    this.refresh();
  },
  onShow() { this.refresh(); },

  missing() { return stats.missingDays(this.data.from, this.data.to, this.data.seasonId); },

  refresh() {
    const days = this.missing();
    let idx = this.data.idx;
    if (idx >= days.length) idx = 0;
    // 没有缺记的日子也要能记：默认停在 today，用户还能自己选日期
    const cur = days.length ? this.curView(days[idx]) : this.curView(this.data.to);
    this.setData({ days, idx, total: days.length, cur });
  },

  curView(d) {
    const s = this.data.seasonId ? store.seasons.get(this.data.seasonId) : null;
    return {
      date: d, dateText: U.cnDate(d, true), week: U.weekday(d),
      dayN: s ? U.diffDays(s.sowDate, d) + 1 : 0
    };
  },

  // ---------- 日期 ----------
  // 选年月日：选完直接把这天当成当前补账日（哪怕它不在「缺记」列表里，也能补）
  onDate(e) {
    const d = e.detail.value;
    const days = this.missing().slice();
    let idx = days.indexOf(d);
    if (idx < 0) { days.push(d); days.sort(); idx = days.indexOf(d); }
    this.setData({ days, idx, total: days.length, cur: this.curView(d) });
  },
  prev() { if (this.data.idx > 0) { this.setData({ idx: this.data.idx - 1 }); this.refresh(); } },
  next() {
    if (!this.data.days.length) return;   // 没有缺记的日子：箭头是灰的，点了什么都不做（不再弹莫名其妙的提示）
    if (this.data.idx + 1 >= this.data.days.length) {
      U.toast('这批都补完了', 'success');
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    this.setData({ idx: this.data.idx + 1 });
    this.refresh();
  },

  // ---------- 类型 ----------
  syncCats() {
    const dir = this.data.dir;
    if (dir === 'in') {
      const list = store.tags.income();
      const cats = list.map(n => ({ key: C.incomeKeyOf(n), name: n, color: C.INCOME_COLOR }));
      const cur = cats.find(c => c.name === this.data.sub) || cats[0];
      this.setData({ cats, cat: cur.key, sub: cur.name, subs: [], label: cur.name });
      return;
    }
    const cats = C.COST_CATS.map(c => ({ key: c.key, name: c.name, color: c.color }));
    let cat = this.data.cat;
    if (!cats.some(c => c.key === cat)) cat = cats[0].key;
    const subs = (C.catOf(cat).subs || []).slice();
    const sub = subs.indexOf(this.data.sub) >= 0 ? this.data.sub : '';
    const c0 = C.catOf(cat);
    this.setData({ cats, cat, subs, sub, label: c0.name + (sub ? ' · ' + sub : '') });
  },
  pickDir(e) { this.setData({ dir: e.currentTarget.dataset.k, sub: '', expr: '', amt: 0, amtText: '0' }); this.syncCats(); },
  pickQuick(e) {
    const k = e.currentTarget.dataset.s;
    const m = QUICK_MAP[k];
    if (!m) return;
    this.setData({ dir: m.dir, cat: m.cat, sub: m.sub });
    this.syncCats();
  },
  pickCat(e) {
    const k = e.currentTarget.dataset.k, n = e.currentTarget.dataset.n;
    if (this.data.dir === 'in') { this.setData({ cat: k, sub: n, label: n }); return; }
    this.setData({ cat: k, sub: '' });
    this.syncCats();
  },
  pickSub(e) { this.setData({ sub: e.currentTarget.dataset.s }); this.syncCats(); },
  onNote(e) { this.setData({ note: e.detail.value }); },

  // ---------- 金额 ----------
  onKey(e) {
    const d = e.detail;
    this.setData({ expr: d.expr, amt: d.value, amtText: U.money(d.value) });
  },
  onDone() { this.save(); },

  save() {
    const d = this.data;
    if (!(d.amt > 0)) return U.toast('先输入金额');
    if (!d.cur) return;
    const sid = d.seasonId || (store.seasons.growing()[0] || {}).id;
    if (!sid) return U.toast('先开一个种植季');
    store.setAuditSrc('catchup');
    store.costs.save({
      date: d.cur.date, dir: d.dir, cat: d.cat, sub: d.sub,
      allocations: [{ seasonId: sid, amount: d.amt }],
      expr: K.hasOp(d.expr) ? d.expr : undefined,
      note: d.note.trim()
    });
    store.setAuditSrc('local');
    U.toast('记好了');
    this.setData({ expr: '', amt: 0, amtText: '0', note: '' });
    this.refresh();
    this.next();
  }
});
