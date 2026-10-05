// 收获：产量（一个总数 / 按地块分行，两种都留）+ 顺手把卖粮收入记了
const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');

const PARTY_KEY = 'guyuji_debt_parties';
const SETTLE = [{ k: 'paid', n: '已结款' }, { k: 'due', n: '未结款' }];

function parties() { try { return wx.getStorageSync(PARTY_KEY) || []; } catch (e) { return []; } }
function pushParty(n) {
  n = (n || '').trim(); if (!n) return parties();
  const list = parties().filter(x => x !== n); list.unshift(n);
  const next = list.slice(0, 8);
  try { wx.setStorageSync(PARTY_KEY, next); } catch (e) {}
  return next;
}

Page({
  data: {
    id: '', date: '', today: '', sowDate: '', yieldJin: '', note: '', preview: {}, area: 0, perMu: '',
    rows: [], rowTotal: 0, rowTotalText: '0', plotName: '', cropName: '',
    // 收入
    withIncome: true, price: '', settle: 'paid', party: '', partyList: [], settleOpts: SETTLE,
    incomeText: '', netText: '', netPos: true, plotOptions: []
  },

  onLoad(q) {
    const s = store.seasons.get(q.id);
    if (!s) { wx.navigateBack(); return; }
    const plot = store.plots.get(s.plotId) || {};
    const crop = C.cropOf(s.crop);
    const rows = (s.harvestRows || []).map(r => {
      const p = store.plots.get(r.plotId) || {};
      return { plotId: r.plotId, name: p.name || '未命名地块', area: +p.area || 0, jin: String(r.jin || ''), perMu: p.area && r.jin ? Math.round(r.jin / p.area) : '' };
    });
    const others = store.plots.all().filter(p => p.id !== s.plotId).map(p => ({ id: p.id, name: p.name }));
    this.setData({
      id: s.id, sowDate: s.sowDate, today: U.today(), area: plot.area || 0, plotName: plot.name || '未命名地块',
      cropName: crop.name, date: s.harvestDate || U.today(), yieldJin: s.yieldJin ? String(s.yieldJin) : '',
      note: s.harvestNote || '', rows, partyList: parties(), dueTags: C.DUE_TAGS, plotOptions: others
    });
    this.calc();
  },

  calc() {
    const s = Object.assign({}, store.seasons.get(this.data.id), { status: 'done', harvestDate: this.data.date });
    const ws = stats.weatherSeries(s);
    const cs = stats.costSummary(s.id);
    // 分行填了就以分行为准（合计 = 各块之和），没填就用上面那个总数
    const rows = this.data.rows.map(r => Object.assign({}, r, {
      perMu: r.area && parseFloat(r.jin) > 0 ? Math.round(parseFloat(r.jin) / r.area) : ''
    }));
    const rowSum = Math.round(rows.reduce((a, r) => a + (parseFloat(r.jin) || 0), 0) * 100) / 100;
    const manual = parseFloat(this.data.yieldJin) || 0;
    const y = rows.length ? rowSum : manual;
    const price = parseFloat(this.data.price) || 0;
    const income = Math.round(price * y * 100) / 100;
    const net = Math.round((income - cs.total) * 100) / 100;
    this.setData({
      rows,
      rowTotal: rowSum, rowTotalText: U.money(rowSum),
      incomeText: U.money(income), netText: U.money(Math.abs(net)), netPos: net >= 0,
      preview: {
        days: U.diffDays(s.sowDate, this.data.date) + 1, gdd: ws.gdd, rain: ws.rain, missing: ws.missing,
        cost: cs.totalText, costNum: cs.total,
        costPerJin: y > 0 && cs.total ? (cs.total / y).toFixed(2) : '',
        income, net, incomeText: U.money(income), netText: U.money(Math.abs(net)), netPos: net >= 0
      },
      perMu: y > 0 && this.data.area ? Math.round(y / this.data.area) : ''
    });
  },

  onDate(e) { this.setData({ date: e.detail.value }); this.calc(); },
  onYield(e) { this.setData({ yieldJin: e.detail.value }); this.calc(); },
  onNote(e) { this.setData({ note: e.detail.value }); },
  onPrice(e) { this.setData({ price: e.detail.value }); this.calc(); },
  onRowJin(e) {
    const i = e.currentTarget.dataset.i;
    const jin = e.detail.value;
    const rows = this.data.rows.slice();
    rows[i] = Object.assign({}, rows[i], { jin });
    this.setData({ rows });
    this.calc();
  },
  toggleIncome() { this.setData({ withIncome: !this.data.withIncome }); this.calc(); },
  pickSettle(e) { this.setData({ settle: e.currentTarget.dataset.k }); this.calc(); },
  onParty(e) { this.setData({ party: e.detail.value }); },
  pickParty(e) { this.setData({ party: e.currentTarget.dataset.n }); },
  // 按地块分行（选填）
  addRow(e) {
    const own = store.seasons.get(this.data.id).plotId;
    const add = id => {
      const p = store.plots.get(id);
      if (!p) return;
      let rows = this.data.rows.slice();
      if (!rows.some(r => r.plotId === own)) {
        const op = store.plots.get(own) || {};
        rows.unshift({ plotId: op.id, name: op.name, area: +op.area || 0, jin: this.data.yieldJin || this.data.rowTotal || '', perMu: '' });
      }
      rows = rows.concat([{ plotId: id, name: p.name, area: +p.area || 0, jin: '', perMu: '' }])
        .filter((r, i, a) => a.findIndex(x => x.plotId === r.plotId) === i);
      this.setData({ rows });
      this.calc();
    };
    const pre = e.currentTarget.dataset.id;
    if (pre) return add(pre);
    const opts = this.data.plotOptions.filter(p => !this.data.rows.some(r => r.plotId === p.id));
    if (!opts.length) return U.toast(this.data.plotOptions.length ? '地块都加上了' : '只有一个地块，直接填上面的总数就行');
    wx.showActionSheet({
      itemList: opts.map(p => p.name),
      success: r => add(opts[r.tapIndex].id)
    });
  },
  delRow(e) {
    const i = e.currentTarget.dataset.i;
    this.setData({ rows: this.data.rows.filter((_, k) => k !== i) });
    this.calc();
  },
  useManual() { this.setData({ rows: [] }); this.calc(); },

  save() {
    const d = this.data;
    const rowSum = d.rows.reduce((a, r) => a + (parseFloat(r.jin) || 0), 0);
    const y = d.rows.length ? Math.round(rowSum * 100) / 100 : parseFloat(d.yieldJin);
    if (!(y > 0)) return U.toast('请填写产量');
    const price = parseFloat(d.price) || 0;
    if (d.withIncome && !(price > 0)) return U.toast('填一下卖价，或关掉「顺手记收入」');
    const party = (d.party || '').trim();
    if (d.withIncome && d.settle === 'due' && !party) return U.toast('未结款要填一下谁欠（粮站/收粮人）');

    const rec = Object.assign({}, store.seasons.get(d.id), { status: 'done', harvestDate: d.date, yieldJin: y, harvestNote: d.note.trim() });
    if (d.rows.length) rec.harvestRows = d.rows.map(r => ({ plotId: r.plotId, jin: parseFloat(r.jin) || 0 }));
    else delete rec.harvestRows;
    store.seasons.save(rec);

    let income = 0;
    if (d.withIncome && price > 0) {
      income = Math.round(price * y * 100) / 100;
      if (party) pushParty(party);
      store.setAuditSrc('harvest');
      store.costs.save({
        dir: 'in', date: d.date, cat: 'grain', sub: d.cropName || '粮食',
        allocations: [{ seasonId: d.id, amount: income }],
        calc: { mode: 'perJin', unitPrice: price, qty: y, unit: '斤' },
        debt: d.settle === 'due' ? { party, settled: false, paidAmount: 0 } : undefined,
        note: (party ? party + ' · ' : '') + U.money(y) + ' 斤 × 1:' + price
      });
      store.setAuditSrc('local');
    }
    const net = Math.round((income - d.preview.costNum) * 100) / 100;
    wx.showModal({
      title: '这一季收官了',
      content: '共 ' + d.preview.days + ' 天，产量 ' + U.money(y) + ' 斤，总投入 ¥' + d.preview.cost
        + (income ? '，收入 ¥' + U.money(income) + '，净收益 ' + (net >= 0 ? '＋' : '−') + '¥' + U.money(Math.abs(net)) : '')
        + (d.withIncome && d.settle === 'due' ? '。粮款还没结，已挂成应收，去「账本 → 欠款」可以销账' : ''),
      showCancel: false, confirmText: '好的',
      success: () => { wx.navigateBack(); }
    });
  }
});
