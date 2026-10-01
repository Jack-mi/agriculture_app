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

test('新建地块只出确认卡，点确认才落库', () => {
  Object.keys(mem).forEach(k => delete mem[k]);
  store.replaceAll({});
  const r = chat.fromLLM({ reply: '给你准备了一块南地，确认就建上。', actions: [{ type: 'plot.create', name: '南地', area: 20 }] }, {});
  assert.strictEqual(r.cards.length, 1);
  assert.strictEqual(r.cards[0].type, 'plot.create');
  assert.strictEqual(store.plots.all().length, 0);
  const ex = chat.execute(r.cards[0]);
  assert.strictEqual(ex.ok, true);
  assert.strictEqual(store.plots.get(ex.plotId).name, '南地');
  assert.strictEqual(store.plots.get(ex.plotId).area, 20);
});

test('总管只挂三个子代理，子代理工具都真实存在', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../cloudfunctions/advisorAgent/index.js'), 'utf8');
  const defined = new Set();
  const tre = /T\('([^']+)'/g;
  let m;
  while ((m = tre.exec(src))) defined.add(m[1]);
  function listed(name) {
    const hit = src.match(new RegExp('const ' + name + ' = pickTools\\(\\[([^\\]]+)\\]\\)'));
    assert.ok(hit, name);
    return hit[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
  }
  ['BOOK_TOOLS', 'LOG_TOOLS', 'AGRI_TOOLS'].forEach(name => {
    const tools = listed(name);
    assert.ok(tools.length >= 5, name);
    tools.forEach(t => assert.ok(defined.has(t), name + ' 缺工具定义 ' + t));
  });
  assert.ok(listed('AGRI_TOOLS').indexOf('draft_locate') >= 0);
  assert.ok(listed('AGRI_TOOLS').indexOf('draft_weather') >= 0);
  assert.ok(listed('BOOK_TOOLS').indexOf('draft_cost_tag') >= 0);
  assert.ok(listed('LOG_TOOLS').indexOf('draft_log_tag') >= 0);
  const orch = [];
  const ore = /T\('(ask_[^']+)'/g;
  while ((m = ore.exec(src))) orch.push(m[1]);
  assert.deepStrictEqual(orch, ['ask_bookkeeper', 'ask_logger', 'ask_agronomist']);
  assert.ok(src.indexOf('MODEL_BUDGET = 20') >= 0);
  assert.ok(src.indexOf('i < 8') < 0);
  const page = fs.readFileSync(path.join(__dirname, '../pages/chat/chat.js'), 'utf8');
  assert.ok(page.indexOf('wx.chooseLocation') >= 0);
});

test('云函数起草的每种动作，小程序都能出确认卡', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../cloudfunctions/advisorAgent/index.js'), 'utf8');
  const types = [];
  const re = /drafts\.push\(\{[\s\S]*?type:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(src))) types.push(m[1]);
  assert.ok(types.length >= 15);
  types.forEach(t => assert.ok(chat.ACTIONS.indexOf(t) >= 0, '缺确认卡：' + t));
  assert.ok(types.indexOf('plot.create') >= 0);
});

test('选点、自定义类型、手改天气：确认前不落库，确认后才写入', () => {
  Object.keys(mem).forEach(k => delete mem[k]);
  store.replaceAll({});
  store.plots.save({ id: 'p1', name: '东大块', area: 12 });
  const r = chat.fromLLM({ reply: '好', actions: [
    { type: 'plot.locate', plotId: 'p1' },
    { type: 'tag.cost', cat: 'agri', name: '拌种剂' },
    { type: 'tag.log', name: '查墒' },
    { type: 'weather.set', plotId: 'p1', date: '2026-10-01', t: 18, p: 0 }
  ] }, {});
  assert.deepStrictEqual(r.cards.map(c => c.type), ['plot.locate', 'tag.cost', 'tag.log', 'weather.set']);
  assert.strictEqual(store.tags.cost('agri').indexOf('拌种剂'), -1);
  assert.strictEqual(chat.execute(r.cards[0]).ok, false);
  assert.strictEqual(store.plots.get('p1').lat, undefined);
  assert.strictEqual(chat.execute(r.cards[1]).ok, true);
  assert.ok(store.tags.cost('agri').indexOf('拌种剂') >= 0);
  assert.strictEqual(chat.execute(r.cards[2]).ok, true);
  assert.ok(store.tags.logTag('查墒'));
  assert.strictEqual(chat.execute(r.cards[3]).ok, true);
  assert.strictEqual(store.weather.get('p1', '2026-10-01').t, 18);
  assert.strictEqual(store.weather.get('p1', '2026-10-01').src, 'manual');
});

test('加粗写成富文本节点，星号不留在正文里', () => {
  const md = require('../utils/md.js');
  const nodes = md.mdNodes('窗口是 **10月6日** 到 **10月21日**');
  const text = JSON.stringify(nodes);
  assert.ok(text.indexOf('**') < 0);
  assert.ok(text.indexOf('font-weight:700') >= 0);
  assert.ok(text.indexOf('background-color:#FFF3C4') >= 0);
  assert.ok(text.indexOf('10月6日') >= 0);
});

test('对话按线程存下来，重开还能读到', () => {
  Object.keys(mem).forEach(k => delete mem[k]);
  const chatlog = require('../utils/chatlog.js');
  chatlog.save({ taskId: 'tk1' }, {
    msgs: [
      { id: 'm1', role: 'me', text: '新建一块南地' },
      { id: 'm2', role: 'ai', text: '确认就建上', nodes: [{ name: 'div' }] },
      { id: 'm3', role: 'ai', thinking: true }
    ],
    history: [{ role: 'user', content: '新建一块南地' }],
    cards: {}
  });
  const back = chatlog.load({ taskId: 'tk1' });
  assert.strictEqual(back.msgs.length, 2);
  assert.strictEqual(back.msgs[1].text, '确认就建上');
  assert.strictEqual(back.msgs[1].nodes, undefined);
  assert.strictEqual(chatlog.load({}), null);
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
