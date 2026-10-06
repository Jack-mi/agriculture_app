// 首次登录引导：新用户（users 建档但头像昵称都为空）第一次打开时由 app.js 拉起，
// 引导用微信「头像昵称填写」能力一次性配好，保存进 users 文档（云端，跨设备）。
const sync = require('../../utils/sync.js');

Page({
  data: { nickName: '', avatarUrl: '' },

  onChooseAvatar(e) { this.setData({ avatarUrl: e.detail.avatarUrl }); },
  onNick(e) { this.setData({ nickName: e.detail.value }); },

  back() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },

  async done() {
    const { nickName, avatarUrl } = this.data;
    if (nickName.trim() || avatarUrl) {
      wx.showLoading({ title: '保存中', mask: true });
      await sync.updateProfile({ nickName, avatarUrl });
      wx.hideLoading();
    }
    this.back();
  },

  skip() { this.back(); }
});
