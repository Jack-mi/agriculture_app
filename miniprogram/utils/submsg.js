// 订阅消息 · 客户端侧
// 三类模板都是「一次性订阅」：用户点一次「允许」= 1 次推送额度，额度权威在云端
// users.subs（weatherDaily 发送成功时扣减）。本地只缓存一份副本，用来决定
// 「要不要提醒用户补订阅」——低于水位线就在首页露出开启横幅。
//
// 注意：wx.requestSubscribeMessage 必须由用户点击触发（基础库 2.8.2+），
// 所以这里只暴露 ask()，由横幅/设置项的 bindtap 调用，不做 onShow 自动弹。
const sync = require('./sync.js');

const TMPL = {
  weather: 'uBHxIQ4wSvJUk3OlAjrc-6i9S2nCzsyVmz5AobkEY4o', // 天气提醒
  task: 'QMWy3vM6cTQ9047ntC71B3yon6V2QuI4YVLonHwx1eU',    // 日程提醒
  alert: '2Km2bGsLWsuTEYSU9cZ28SeZUEPJ_W-ey5dULONH6z0'    // 气象灾害预警
};
const KINDS = ['weather', 'alert', 'task'];
// 水位线：任一类额度低于这个数就提醒补订（一次弹窗可补三类）
const BUFFER = 3;
const ASK_KEY = 'guyuji_sub_lastask';

function credits() { return sync.subs(); }

// 需要补订的类目（纯函数，可单测）
function needKinds(subs, buffer) {
  const b = buffer === undefined ? BUFFER : buffer;
  return KINDS.filter(k => ((subs || {})[k] || 0) < b);
}

// 今天是否已经请用户订阅过（弹窗一天最多一次，不烦人；纯函数，可单测）
function askedToday(lastAsk, today) { return !!lastAsk && lastAsk === today; }

function markAsked(today) { try { wx.setStorageSync(ASK_KEY, today); } catch (e) {} }
function lastAsk() { try { return wx.getStorageSync(ASK_KEY) || ''; } catch (e) { return ''; } }

// 首页横幅是否该出现：有地在种 + 有类目低于水位 + 今天没弹过
function shouldShowBanner(hasPlots, today) {
  if (!hasPlots) return false;
  if (askedToday(lastAsk(), today)) return false;
  return needKinds(credits()).length > 0;
}

// 弹订阅面板（用户点击触发）。accepted 的类目逐条 +1 额度上报云端。
// 返回 { accepted: [kind], rejected: [kind] }；面板调起失败也按全拒绝处理。
function ask(kinds, today) {
  const list = (kinds && kinds.length ? kinds : KINDS).filter(k => TMPL[k]);
  markAsked(today || new Date().toISOString().slice(0, 10));
  return new Promise(resolve => {
    wx.requestSubscribeMessage({
      tmplIds: list.map(k => TMPL[k]),
      success: res => {
        const accepted = list.filter(k => res[TMPL[k]] === 'accept');
        const rejected = list.filter(k => res[TMPL[k]] !== 'accept');
        accepted.forEach(k => sync.subInc(k, 1));
        resolve({ accepted, rejected });
      },
      fail: () => resolve({ accepted: [], rejected: list })
    });
  });
}

module.exports = { TMPL, KINDS, BUFFER, needKinds, askedToday, shouldShowBanner, ask, credits };
