// 记账设置（二级页）：类型管理 / 记账键盘 / 回收站
// 从「我的」收进来的一层，下面三个子入口各自还是独立页
const store = require('../../utils/store.js');

Page({
  data: { trash: 0 },

  onShow() { this.setData({ trash: store.trash.count() }); },

  goTags() { wx.navigateTo({ url: '/pages/tags/tags' }); },
  goKeypanel() { wx.navigateTo({ url: '/pages/keypanel/keypanel' }); },
  goTrash() { wx.navigateTo({ url: '/pages/trash/trash' }); }
});
