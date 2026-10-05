// 资金账户：钱在哪个口袋（现金 / 微信 / 银行卡…）
// 账户列表挂在 tags 单文档；余额 = 期初 + Σ收入 − Σ支出（按分摊后金额，没挂账户的账不计入）
const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const U = require('../../utils/util.js');

const SCOPES = [{ k: 'all', n: '全部' }, { k: 'year', n: '今年' }, { k: 'month', n: '本月' }];

Page({
  data: { scopes: SCOPES, scope: 'all', scopeName: '全部', sum: {}, rows: [], edit: [] },

  onShow() { this.render(); },

  render() {
    const scope = this.data.scope;
    const today = U.today();
    const filter = scope === 'year' ? (c => c.date.slice(0, 4) === today.slice(0, 4))
      : scope === 'month' ? (c => c.date.slice(0, 7) === today.slice(0, 7)) : null;
    const sum = stats.accountRows(filter);
    const edit = sum.rows.map(r => ({
      key: r.key, name: r.name, initText: r.init ? String(r.init) : '',
      incomeText: r.incomeText, expenseText: r.expenseText,
      netText: (r.net >= 0 ? '＋' : '−') + U.money(Math.abs(r.net)),
      balanceText: r.balanceText, count: r.count, neg: r.balance < 0
    }));
    this.setData({ sum, edit, scopeName: (SCOPES.find(s => s.k === scope) || {}).n });
  },

  setScope(e) { this.setData({ scope: e.currentTarget.dataset.k }); this.render(); },

  onIn(e) {
    const i = +e.currentTarget.dataset.i, k = e.currentTarget.dataset.k;
    const edit = this.data.edit.slice();
    edit[i][k === 'name' ? 'name' : 'initText'] = e.detail.value;
    this.setData({ edit });
  },

  add() {
    const edit = this.data.edit.concat([{ key: '', name: '', initText: '', incomeText: '0.00', expenseText: '0.00', netText: '＋0.00', balanceText: '0.00', count: 0, neg: false }]);
    this.setData({ edit });
  },

  del(e) {
    const i = +e.currentTarget.dataset.i;
    const edit = this.data.edit.slice();
    const gone = edit.splice(i, 1)[0];
    this.setData({ edit });
    wx.showModal({
      title: '删掉这个账户',
      content: '「' + (gone.name || '未命名') + '」上的账目不会删，只是不再按账户归类。',
      success: r => { if (r.confirm) { this.persist(); } else { this.render(); } }
    });
  },

  persist() {
    store.accounts.save(this.data.edit.map(r => ({ key: r.key, name: (r.name || '').trim(), init: parseFloat(r.initText) || 0 })));
  },

  save() {
    if (!this.data.edit.length) return U.toast('至少留一个账户');
    if (this.data.edit.some(r => !(r.name || '').trim())) return U.toast('账户名不能空');
    this.persist();
    U.toast('账户已保存');
    this.render();
  }
});
