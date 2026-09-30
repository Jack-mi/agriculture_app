// 谷雨记 · 入口
// 云开发环境 ID：留空 = 纯本地模式（数据只存在手机里）；
// 填入云开发环境 ID 后，数据会在联网时自动备份到云端（按微信 openid 隔离，即"微信授权即建档"）。
const CLOUD_ENV = '';

const sync = require('./utils/sync.js');

App({
  globalData: { cloudEnv: CLOUD_ENV, online: true },

  onLaunch() {
    sync.init(CLOUD_ENV);
    wx.getNetworkType({
      success: (r) => { this.globalData.online = r.networkType !== 'none'; }
    });
    // 弱网兜底：网络恢复时自动同步
    wx.onNetworkStatusChange((r) => {
      this.globalData.online = r.isConnected;
      if (r.isConnected) sync.flush();
    });
    sync.pullIfEmpty().then(() => sync.flush());
  },

  onShow() { sync.flush(); },

  // store 每次写入后调用，做节流同步
  onDataChanged() {
    clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => sync.flush(), 3000);
  }
});
