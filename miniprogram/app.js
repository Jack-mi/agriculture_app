// 田祖记 · 入口
// 云开发环境 ID：留空 = 纯本地模式（数据只存在手机里，天气自动获取不可用）；
// 填入云开发环境 ID 后：wx.login 静默建档（users 集合），数据分集合逐条同步（按 openid 隔离），
// 天气由云函数统一拉取。部署步骤见 docs/deploy.md。
const CLOUD_ENV = 'cloud1-d5gzevmwkdff99eb5';

const sync = require('./utils/sync.js');
const weather = require('./utils/weather.js');

App({
  // aiModel：配置后「跟参谋说」先走云开发 AI 大模型理解（结果仍经白名单 + 确认卡片）；留空 = 纯本地规则解析
  // 例：{ provider: 'hunyuan-exp', name: 'hunyuan-turbos-latest' }，需在云开发控制台开通 AI 能力，基础库 ≥ 3.7.1
  globalData: { cloudEnv: CLOUD_ENV, online: true, aiModel: null },

  onLaunch() {
    sync.init(CLOUD_ENV);
    wx.getNetworkType({
      success: (r) => { this.globalData.online = r.networkType !== 'none'; }
    });
    // 弱网兜底：网络恢复时自动同步
    wx.onNetworkStatusChange((r) => {
      this.globalData.online = r.isConnected;
      if (r.isConnected) sync.pull().then(() => sync.flush());
    });
    // 先静默登录建档，再增量拉取，最后把本地积压的变更推上去
    sync.login().then(() => { this._maybeProfileSetup(); return sync.pull(); }).then(() => sync.flush());
  },

  // 新用户（头像昵称都为空）首次登录拉起资料设置页；设置/跳过后置标记，不再打扰。
  // 拉起失败（首页还没就绪等极端情况）不置标记，「我的」页的一次性引导兜底。
  _maybeProfileSetup() {
    const p = sync.profile();
    if (p.nickName || p.avatarUrl) return;
    if (wx.getStorageSync('guyuji_profile_guide')) return;
    wx.navigateTo({
      url: '/pages/profile-setup/profile-setup',
      success: () => wx.setStorageSync('guyuji_profile_guide', 1),
      fail: () => null
    });
  },

  onShow() {
    sync.flush();
    // 天气兜底：每天首次打开时补昨日/缺失天气（不依赖云函数定时触发器）
    sync.login().then(() => weather.bootFill()).catch(() => null);
  },

  // store 每次写入后调用，做节流同步
  onDataChanged() {
    clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => sync.flush(), 3000);
  }
});
