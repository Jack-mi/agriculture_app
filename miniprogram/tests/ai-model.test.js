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

test('BYOK 全链路：ask → advisorChat 云函数 → fromLLM 出卡（用线上真实 LLM 响应回放）', async () => {
  Object.keys(mem).forEach(k => delete mem[k]);
  mem[chat.AI_MODEL_KEY] = 'byok';
  // 2026-10-01 线上 deepseek-flash 对「后天提醒我去东大块打除草剂」的真实返回
  const REAL_LLM_TEXT = '{"reply":"行，10月3号提醒你去东大块打除草剂。","actions":[{"type":"task.create","seasonId":"SEED","title":"去东大块打除草剂","date":"2026-10-03"}]}';
  global.wx.cloud = {
    callFunction: ({ name, data }) => {
      assert.strictEqual(name, 'advisorChat');
      assert.strictEqual(data.action, 'chat');
      assert.ok(Array.isArray(data.messages) && data.messages.length === 2);
      return Promise.resolve({ result: { ok: true, text: REAL_LLM_TEXT.replace('SEED', 's1') } });
    }
  };
  const store = require('../utils/store.js');
  store.replaceAll({});
  store.plots.save({ id: 'p1', name: '东大块', area: 12 });
  store.seasons.save({ id: 's1', plotId: 'p1', crop: 'wheat', sowDate: '2026-09-30' });
  const r = await chat.ask('后天提醒我去东大块打除草剂', { seasonId: 's1' }, null);
  assert.ok(r.reply.indexOf('除草剂') >= 0);
  assert.strictEqual(r.cards.length, 1);
  assert.strictEqual(r.cards[0].type, 'task.create');
  assert.strictEqual(r.cards[0].payload.dueStart, '2026-10-03');
  delete global.wx.cloud;
});
