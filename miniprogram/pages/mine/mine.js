// 我的：只放「账号 / 数据同步 / 分享 / 关于」。
// 记账相关的入口（报表/欠款/库存/预算/账户/资产负债/类型/周期账/键盘/回收站）都在「账本」页。
const store = require('../../utils/store.js');
const U = require('../../utils/util.js');
const sync = require('../../utils/sync.js');

// 上次同步距今多久（给人看的粗粒度，够用就行）
function ago(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  return U.dt(ts);
}

Page({
  data: { counts: {}, year: '', sync: { state: '', ok: false } },

  onShow() {
    const d = store.db();
    const gd = (getApp() || {}).globalData || {};
    const pending = store.outbox().length;
    const syncedAt = wx.getStorageSync('guyuji_synced_at') || 0;
    const dead = sync.status().dead || 0;
    const online = gd.online !== false;
    // 说人话：数据本来就在云上，这里报的是「同步状态」，不是一个要打开的开关
    let state, ok = false;
    if (wx.getStorageSync('guyuji_storage_err')) state = '本机存储快满了，最近的改动可能没存住，清下缓存或联系我们';
    else if (dead) state = dead + ' 条没传上去（点这里重试）';
    else if (!gd.cloudEnv) state = '这台手机没连云端，数据只存在本机';
    else if (!online) state = '当前离线' + (pending ? '，' + pending + ' 条等联网后自动传' : '，联网后自动同步');
    else if (pending) state = pending + ' 条正在上传…';
    else if (syncedAt) { state = '已同步到云端 · ' + ago(syncedAt); ok = true; }
    else state = '还没同步过，点一下立刻传';
    this.setData({
      year: U.today().slice(0, 4),
      counts: {
        plots: d.plots.length, seasons: d.seasons.length,
        costs: d.costs.filter(c => !c.deletedAt).length,
        logs: d.logs.filter(l => !l.deletedAt).length
      },
      sync: { state, ok }
    });
  },

  syncNow() {
    const gd = (getApp() || {}).globalData || {};
    if (!gd.cloudEnv) return wx.showModal({ title: '没连云端', content: '数据现在只存在这台手机上。', showCancel: false });
    if (gd.online === false) return U.toast('当前没网，联网后会自动同步');
    U.toast('正在同步…');
    sync.retryDead();
    sync.login().then(() => sync.pull()).then(() => sync.flush())
      .then(() => { U.toast('同步完成', 'success'); this.onShow(); })
      .catch(() => U.toast('同步失败，联网后会自动重试'));
  },

  // 记账设置：压成一行，点进去才是 类型管理 / 记账键盘 / 回收站（用户要求）
  goLedgerSettings() { wx.navigateTo({ url: '/pages/ledger-settings/ledger-settings' }); },

  about() {
    wx.showModal({
      title: '关于谷雨记',
      content: '谷雨种谷，雨生百谷。记下作物生长的每一场雨、每一天。\n天气数据来自 Open-Meteo 开源天气。',
      showCancel: false
    });
  },
  onShareAppMessage() { return { title: '谷雨记 · 种地记账本，比纸本好用', path: '/pages/index/index' }; }
});
