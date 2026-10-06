// 记账键盘设置（F22）：预设 / 左下功能键 / 金额显示
// 只影响本机（utils/pref.js），不同步云端，换手机回默认
const pref = require('../../utils/pref.js');
const U = require('../../utils/util.js');

const PRESETS = [
  { k: 'default', n: '默认', desc: '左下「再记」，开千分位和按键震动' },
  { k: 'entry', n: '连续录入', desc: '左下「清空」——一笔接一笔录的时候顺手' },
  { k: 'simple', n: '极简', desc: '关千分位和按键震动，界面最干净' }
];
const FN_KEYS = [
  { k: 'again', n: '再记' }, { k: 'clear', n: '清空' },
  { k: 'today', n: '今天' }, { k: 'tpl', n: '常用账' }, { k: 'attach', n: '附件' }
];
const PRESET_MAP = {
  default: { fnKey: 'again', recentCount: 4, recentSub: true, thousands: true, vibrate: true, longClear: true },
  entry: { fnKey: 'clear', recentCount: 6, recentSub: true, thousands: true, vibrate: true, longClear: true },
  simple: { fnKey: 'again', recentCount: 0, recentSub: false, thousands: false, vibrate: false, longClear: true }
};

Page({
  data: { p: {}, presets: PRESETS, fnKeys: FN_KEYS, sample: '' },

  onShow() { this.setData({ p: pref.all(), sample: '15,120' }); },

  pickPreset(e) {
    const k = e.currentTarget.dataset.k;
    const p = pref.set(Object.assign({ preset: k }, PRESET_MAP[k] || {}));
    this.setData({ p });
    U.toast('已套用「' + (PRESETS.find(x => x.k === k) || {}).n + '」');
  },
  pickFn(e) { this.setData({ p: pref.set({ fnKey: e.currentTarget.dataset.k, preset: 'custom' }) }); },
  toggle(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ p: pref.set({ [k]: !this.data.p[k], preset: 'custom' }) });
  },
  reset() {
    const p = pref.reset();
    this.setData({ p });
    U.toast('已恢复默认');
  }
});
