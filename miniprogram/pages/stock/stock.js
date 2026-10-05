// 库存：农资（手动入出库，可自动扣减）/ 粮食（由收获量与卖粮收入派生）
const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');

const AGRI_UNITS = ['袋', '斤', '瓶', '件', '吨'];

Page({
  data: {
    tabs: [{ k: 'agri', n: '农资' }, { k: 'grain', n: '粮食' }], tab: 'agri',
    inited: false, sum: {}, items: [], grain: [], units: AGRI_UNITS,
    sheet: '', move: { dir: 'in', name: '', unit: '袋', qty: '', price: '', date: '', warnAt: '', makeCost: true },
    names: [], cats: C.COST_CATS, pickCat: 'agri', pickSub: '化肥', today: ''
  },
  onLoad() { this.setData({ today: U.today() }); },
  onShow() { this.render(); },

  render() {
    const s = stats.stockSummary();
    const agriNames = s.items.map(x => x.name);
    ['种子', '农药', '化肥'].forEach(n => { if (agriNames.indexOf(n) < 0) agriNames.push(n); });
    // 粮食：按季派生（收获量 − 已卖）
    const grain = store.seasons.all().map(se => {
      const p = store.plots.get(se.plotId) || {};
      const harvest = +se.yieldJin || 0;
      let sold = 0;
      // 已卖斤数只认「按斤×价」记的卖粮（calc.qty）；只填金额的不猜
      store.costs.all(c => store.isIncome(c) && store.costs.allocOf(c).some(a => a.seasonId === se.id))
        .forEach(c => { if (c.calc && c.calc.mode === 'perJin') sold += +c.calc.qty || 0; });
      return {
        id: se.id, name: (p.name || '未命名') + ' · ' + C.cropOf(se.crop).name,
        harvest: U.money(harvest), sold: U.money(sold), onHand: U.money(Math.max(0, harvest - sold)),
        onHandNum: Math.max(0, harvest - sold), finished: se.status === 'done'
      };
    }).filter(g => g.harvest !== '0');
    this.setData({
      inited: store.stock.inited(),
      sum: { total: s.totalValueText, count: s.count, low: s.lowCount },
      items: s.items, grain, names: agriNames
    });
  },

  setTab(e) { this.setData({ tab: e.currentTarget.dataset.k }); },
  initStock() { store.stock.init(true); store.tags.setLogStock(true); U.toast('期初模式已开，之后的出入库会自动扣减'); this.render(); },
  initLogOnly() { store.stock.init(false); store.tags.setLogStock(false); U.toast('只记录不扣减'); this.render(); },

  startMove(dir, name) {
    const it = name ? store.stock.find(name) : null;
    this.setData({
      sheet: 'move',
      'move.dir': dir || 'in', 'move.name': name || '', 'move.unit': it ? it.unit : '袋',
      'move.qty': '', 'move.price': it ? String(it.lastPrice || '') : '',
      'move.warnAt': it && it.warnAt ? String(it.warnAt) : '', 'move.date': U.today(), 'move.makeCost': (dir || 'in') === 'in'
    });
  },
  openMove(e) {
    const d = e.currentTarget.dataset || {};
    this.startMove(d.dir || 'in', d.name || '');
  },
  closeSheet() { this.setData({ sheet: '' }); },
  noop() {},
  pickDir(e) { this.setData({ 'move.dir': e.currentTarget.dataset.k, 'move.makeCost': e.currentTarget.dataset.k === 'in' }); },
  pickName(e) { this.setData({ 'move.name': e.currentTarget.dataset.n }); },
  pickUnit(e) { this.setData({ 'move.unit': e.currentTarget.dataset.u }); },
  onField(e) { this.setData({ ['move.' + e.currentTarget.dataset.k]: e.detail.value }); },
  onDate(e) { this.setData({ 'move.date': e.detail.value }); },
  toggleCost() { this.setData({ 'move.makeCost': !this.data.move.makeCost }); },
  addName() {
    wx.showModal({
      title: '新增品名', editable: true, placeholderText: '如：复合肥 40kg',
      success: r => { if (r.confirm && (r.content || '').trim()) this.setData({ 'move.name': r.content.trim() }); }
    });
  },
  pickCat(e) { const k = e.currentTarget.dataset.k; this.setData({ pickCat: k, pickSub: (store.tags.cost(k)[0] || '') }); },
  pickSub(e) { this.setData({ pickSub: e.currentTarget.dataset.s }); },

  save() {
    const m = this.data.move;
    if (!m.name) return U.toast('先选或新增品名');
    const qty = parseFloat(m.qty);
    if (!(qty > 0)) return U.toast('填一下数量');
    const delta = m.dir === 'in' ? qty : -qty;
    store.stock.applyDelta(m.name, m.unit, delta, { price: parseFloat(m.price) || 0 });
    if (m.warnAt !== '') store.stock.upsert({ name: m.name, unit: m.unit, warnAt: parseFloat(m.warnAt) || 0 });
    if (m.dir === 'in' && m.makeCost) {
      const amount = Math.round(qty * (parseFloat(m.price) || 0) * 100) / 100;
      if (amount > 0) {
        const growing = store.seasons.growing();
        const picked = growing.length ? growing.map(s => s.id) : (store.seasons.all()[0] ? [store.seasons.all()[0].id] : []);
        if (picked.length) {
          const allocs = picked.length > 1 ? store.costs.allocByArea(amount, picked) : [{ seasonId: picked[0], amount }];
          store.setAuditSrc('stock');
          store.costs.save({
            date: m.date, dir: 'out', cat: this.data.pickCat, sub: this.data.pickSub, allocations: allocs,
            note: m.name + ' ' + qty + m.unit + (m.price ? ' × ¥' + m.price : '')
          });
          store.setAuditSrc('local');
        }
      }
    }
    U.toast(m.dir === 'in' ? '入库好了' : '出库好了', 'success');
    this.setData({ sheet: '' });
    this.render();
  },
  removeItem(e) {
    const name = e.currentTarget.dataset.n;
    wx.showModal({
      title: '移出库存', content: '「' + name + '」的余量记录会删掉，已记的账和记事不动。',
      success: r => { if (r.confirm) { store.stock.remove(name); this.render(); } }
    });
  },
  editItem(e) { this.startMove('in', e.currentTarget.dataset.n); },
  goLedger() { wx.switchTab({ url: '/pages/ledger/ledger' }); }
});
