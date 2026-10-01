// 参谋模型切换 · 最小用例
const test = require('node:test');
const assert = require('node:assert');

const mem = {};
global.wx = {
  getStorageSync: k => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; }
};
global.getApp = () => ({ globalData: { aiModel: null } });

const chat = require('../utils/chat.js');

test('默认回落本地规则；切换后读取所选模型', () => {
  Object.keys(mem).forEach(k => delete mem[k]);
  assert.strictEqual(chat.modelChoice().key, 'local');
  mem[chat.AI_MODEL_KEY] = 'dsv3';
  assert.strictEqual(chat.modelChoice().name, 'deepseek-v3');
  assert.strictEqual(chat.modelChoice().provider, 'deepseek');
  // 非法 key 回落本地规则
  mem[chat.AI_MODEL_KEY] = 'nope';
  assert.strictEqual(chat.modelChoice().key, 'local');
});

test('app.globalData.aiModel 作为缺省（用户未选过时）', () => {
  Object.keys(mem).forEach(k => delete mem[k]);
  global.getApp = () => ({ globalData: { aiModel: { provider: 'hunyuan-exp', name: 'hunyuan-turbos-latest' } } });
  assert.strictEqual(chat.modelChoice().name, 'hunyuan-turbos-latest');
  // 用户显式选择优先于 globalData
  mem[chat.AI_MODEL_KEY] = 'local';
  assert.strictEqual(chat.modelChoice().key, 'local');
});
