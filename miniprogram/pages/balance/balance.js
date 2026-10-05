// 资产负债总览：资产 = 账户余额 + 库存估值 + 应收；负债 = 应付
// 全部由 stats.balanceSheet 本地算，复用资金账户 / 库存 / 欠款三处现有数据
const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const U = require('../../utils/util.js');

Page({
  data: { bs: {} },

  onShow() { this.render(); },

  render() {
    const bs = stats.balanceSheet();
    bs.netNeg = bs.net < 0;
    bs.assetRows = [
      { name: '资金账户余额', hint: '账户期初 + 收 − 支', value: bs.cash, text: bs.cashText, go: 'funds' },
      { name: '库存估值', hint: bs.stockCount + ' 个品名 · 按最近均价', value: bs.stockValue, text: bs.stockValueText, go: 'stock' },
      { name: '应收（还没收到的钱）', hint: bs.receivableCount + ' 笔未结', value: bs.receivable, text: bs.receivableText, go: 'debt' }
    ];
    bs.liabRows = [
      { name: '应付（还没付出的钱）', hint: bs.payableCount + ' 笔未结', value: bs.payable, text: bs.payableText, go: 'debt' }
    ];
    this.setData({ bs });
  },

  go(e) {
    const k = e.currentTarget.dataset.go;
    if (k === 'funds') return wx.navigateTo({ url: '/pages/funds/funds' });
    if (k === 'stock') return wx.navigateTo({ url: '/pages/stock/stock' });
    if (k === 'debt') return wx.navigateTo({ url: '/pages/debt/debt' });
  }
});
