// 参谋模型切换 + agent 链路 · 最小用例
const test = require('node:test');
const assert = require('node:assert');

const mem = {};
global.wx = {
  getStorageSync: k => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; }
};
global.getApp = () => ({ globalData: {} });

const chat = require('../utils/chat.js');
const store = require('../utils/store.js');

test('模型选择：默认 flash，可切 pro，非法 key 回落默认', () => {
  Object.keys(mem).forEach(k => delete mem[k]);
  assert.strictEqual(chat.modelChoice().model, 'deepseek-flash');
  mem[chat.AI_MODEL_KEY] = 'byokpro';
  assert.strictEqual(chat.modelChoice().model, 'deepseek-v4-pro');
  mem[chat.AI_MODEL_KEY] = 'nope';
  assert.strictEqual(chat.modelChoice().model, 'deepseek-flash');
});

test('agent 链路：ask → advisorAgent → fromLLM 出卡（无本地规则参与）', async () => {
  Object.keys(mem).forEach(k => delete mem[k]);
  let seen = null;
  global.wx.cloud = {
    callFunction: ({ name, data }) => {
      seen = { name, data };
      return Promise.resolve({
        result: {
          ok: true,
          reply: '行，10月3号提醒你去东大块打除草剂。',
          actions: [{ type: 'task.create', seasonId: 's1', title: '去东大块打除草剂', date: '2026-10-03' }],
          toolTrace: ['query_seasons', 'draft_task']
        }
      });
    }
  };
  store.replaceAll({});
  store.plots.save({ id: 'p1', name: '东大块', area: 12 });
  store.seasons.save({ id: 's1', plotId: 'p1', crop: 'wheat', sowDate: '2026-09-30' });
  const r = await chat.ask('后天提醒我去东大块打除草剂', { seasonId: 's1' }, null, []);
  assert.strictEqual(seen.name, 'advisorAgent');
  assert.ok(seen.data.context.today);
  assert.ok(r.reply.indexOf('除草剂') >= 0);
  assert.strictEqual(r.cards.length, 1);
  assert.strictEqual(r.cards[0].type, 'task.create');
  assert.strictEqual(r.cards[0].payload.dueStart, '2026-10-03');
  delete global.wx.cloud;
});

test('agent 失败：nokey → 引导配 Key；其他失败 → 诚实报错（绝不回落规则）', async () => {
  Object.keys(mem).forEach(k => delete mem[k]);
  store.replaceAll({});
  global.wx.cloud = { callFunction: () => Promise.resolve({ result: { ok: false, reason: 'nokey' } }) };
  let r = await chat.ask('这季花了多少', {}, null, []);
  assert.ok(r.reply.indexOf('Key') >= 0);
  global.wx.cloud = { callFunction: () => Promise.reject(new Error('network')) };
  r = await chat.ask('这季花了多少', {}, null, []);
  assert.ok(r.reply.indexOf('网络') >= 0 || r.reply.indexOf('试') >= 0);
  delete global.wx.cloud;
});
