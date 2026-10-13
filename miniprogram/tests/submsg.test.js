// 订阅消息客户端逻辑 · 最小用例（node --test miniprogram/tests/）
const test = require('node:test');
const assert = require('node:assert');

const mem = {};
global.wx = { getStorageSync: k => mem[k], setStorageSync: (k, v) => { mem[k] = v; } };

const submsg = require('../utils/submsg.js');

test('needKinds：低于水位线的类目都要补订', () => {
  assert.deepStrictEqual(submsg.needKinds({ weather: 0, alert: 5, task: 2 }), ['weather', 'task']);
  assert.deepStrictEqual(submsg.needKinds({ weather: 3, alert: 3, task: 3 }), []);
  assert.deepStrictEqual(submsg.needKinds({}), ['weather', 'alert', 'task']);
});

test('askedToday：同一天只弹一次', () => {
  assert.strictEqual(submsg.askedToday('2026-10-13', '2026-10-13'), true);
  assert.strictEqual(submsg.askedToday('2026-10-12', '2026-10-13'), false);
  assert.strictEqual(submsg.askedToday('', '2026-10-13'), false);
});

test('shouldShowBanner：没地不打扰、弹过不再弹、额度够不弹', () => {
  mem['guyuji_subs'] = { weather: 0, alert: 0, task: 0 };
  mem['guyuji_sub_lastask'] = '';
  assert.strictEqual(submsg.shouldShowBanner(false, '2026-10-13'), false); // 没地块
  assert.strictEqual(submsg.shouldShowBanner(true, '2026-10-13'), true);
  mem['guyuji_sub_lastask'] = '2026-10-13';
  assert.strictEqual(submsg.shouldShowBanner(true, '2026-10-13'), false); // 今天弹过
  mem['guyuji_sub_lastask'] = '2026-10-12';
  mem['guyuji_subs'] = { weather: 9, alert: 9, task: 9 };
  assert.strictEqual(submsg.shouldShowBanner(true, '2026-10-13'), false); // 额度充足
});
