// 本机偏好（不同步云端）：记账键盘等只跟设备走的设置
const KEY = 'guyuji_kp_pref';

const DEFAULT = {
  preset: 'default',      // default | amount | custom
  fnKey: 'again',         // 左下角功能键：again 再记 / clear 清空 / today 今天 / tpl 常用账 / attach 附件
  recentCount: 4,         // 最近用过的分类显示几个（0 = 关）
  recentSub: true,        // 是否带细分（化肥 · 复合肥）
  thousands: true,        // 千分位
  vibrate: true,          // 按键震动
  longClear: true         // ⌫ 长按清空
};

function all() {
  let v = {};
  try { v = wx.getStorageSync(KEY) || {}; } catch (e) { v = {}; }
  return Object.assign({}, DEFAULT, v);
}
function set(patch) {
  const next = Object.assign(all(), patch || {});
  try { wx.setStorageSync(KEY, next); } catch (e) {}
  return next;
}
function reset() { try { wx.removeStorageSync(KEY); } catch (e) {} return all(); }

// 最近用过的分类（本机记录，最多 8 个，最新的在前）
const RECENT_KEY = 'guyuji_recent_cat';
function recents() {
  try { return wx.getStorageSync(RECENT_KEY) || []; } catch (e) { return []; }
}
function pushRecent(cat, sub, dir) {
  if (!cat) return recents();
  const key = (dir || 'out') + '|' + cat + '|' + (sub || '');
  const list = recents().filter(x => x.k !== key);
  list.unshift({ k: key, cat, sub: sub || '', dir: dir || 'out' });
  const next = list.slice(0, 8);
  try { wx.setStorageSync(RECENT_KEY, next); } catch (e) {}
  return next;
}
function recentFor(dir, count, withSub) {
  const n = count === undefined ? 4 : +count;
  if (!n) return [];
  return recents().filter(x => x.dir === (dir || 'out')).slice(0, n).map(x => ({
    cat: x.cat, sub: x.sub,
    label: withSub === false ? null : x.sub,
    key: x.k
  }));
}

module.exports = { all, set, reset, DEFAULT, recents, pushRecent, recentFor, KEY };
