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
    // 两处合计（资产合计 / 负债合计）和净资产、总资产、总负债是同一批数字，重复，已删。
    // 资金账户余额 / 库存估值的两行小字说明也删了——底部那条口径说明已经讲清楚。
    bs.assetRows = [
      { name: '资金账户余额', hint: '', value: bs.cash, text: bs.cashText, go: 'funds' },
      { name: '库存估值', hint: '', value: bs.stockValue, text: bs.stockValueText, go: 'stock' },
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
