// 参谋记账能力扩展（0.7 记账模块对齐）：收入/赊账/销账/周期账/库存/收入类型/改季/改记事/软删
const test = require('node:test');
const assert = require('node:assert');

const mem = {};
global.wx = { getStorageSync: k => mem[k], setStorageSync: (k, v) => { mem[k] = v; } };
global.getApp = () => null;

const chat = require('../utils/chat.js');
const store = require('../utils/store.js');

function reset() {
  Object.keys(mem).forEach(k => delete mem[k]);
  store.replaceAll({});
  store.plots.save({ id: 'p1', name: '东大块', area: 12 });
  store.seasons.save({ id: 's1', plotId: 'p1', crop: 'wheat', sowDate: '2026-09-30' });
}
function oneCard(json) {
  const r = chat.fromLLM(json, { seasonId: 's1' });
  assert.strictEqual(r.cards.length, 1, '应出一张卡: ' + JSON.stringify(json.actions));
  return r.cards[0];
}

test('记收入：按斤×价卖粮，dir=in 落库', () => {
  reset();
  const card = oneCard({ reply: '', actions: [{ type: 'cost.create', cost: { seasonIds: ['s1'], dir: 'in', cat: 'grain', sub: '卖粮', date: '2026-10-06', money: { mode: 'perJin', unitPrice: 1.2, qty: 12600 } } }] });
  assert.strictEqual(card.type, 'cost.create');
  const ex = chat.execute(card);
  assert.strictEqual(ex.ok, true);
  const c = store.costs.get(ex.costId);
  assert.strictEqual(store.isIncome(c), true);
  assert.strictEqual(store.allocTotal(c), 15120);
});

test('挂赊账 → 部分销账 → 全部结清', () => {
  reset();
  const card = oneCard({ reply: '', actions: [{ type: 'cost.create', cost: { seasonIds: ['s1'], dir: 'out', cat: 'agri', sub: '农药', date: '2026-10-06', money: { mode: 'fixed', amount: 500 }, debt: { party: '老张农资店' } } }] });
  assert.ok(card.rows.some(r => String(r).indexOf('老张农资店') >= 0));
  const ex = chat.execute(card);
  const c = store.costs.get(ex.costId);
  assert.ok(c.debt && !c.debt.settled);
  assert.strictEqual(store.costs.debtTotal('out'), 500);
  // 部分销 200
  const st1 = oneCard({ reply: '', actions: [{ type: 'debt.settle', costId: c.id, amount: 200 }] });
  chat.execute(st1);
  assert.strictEqual(store.costs.debtTotal('out'), 300);
  // 不填金额 = 全部结清
  const st2 = oneCard({ reply: '', actions: [{ type: 'debt.settle', costId: c.id }] });
  chat.execute(st2);
  assert.strictEqual(store.costs.debtTotal('out'), 0);
  assert.strictEqual(store.costs.get(c.id).debt.settled, true);
});

test('AI 删账进回收站（软删），能恢复', () => {
  reset();
  const c = store.costs.save({ seasonId: 's1', date: '2026-10-05', cat: 'agri', sub: '种子', allocations: [{ seasonId: 's1', amount: 100 }] });
  const card = oneCard({ reply: '', actions: [{ type: 'cost.remove', costId: c.id }] });
  chat.execute(card);
  assert.ok(store.costs.get(c.id).deletedAt, '应软删');
  assert.strictEqual(store.trash.count(), 1);
  store.trash.restore('costs', c.id);
  assert.ok(!store.costs.get(c.id).deletedAt);
});

test('周期账：创建后出现在清单里，到期日能算出来', () => {
  reset();
  const card = oneCard({ reply: '', actions: [{ type: 'recurring.create', recurring: { name: '土地流转', dir: 'out', cat: 'asset', sub: '土地流转', amount: 6000, freq: 'year', day: 1, month: 10 } }] });
  assert.strictEqual(card.type, 'recurring.create');
  chat.execute(card);
  const items = store.recurring.items();
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].name, '土地流转');
  assert.ok(store.recurring.nextOn(items[0], '2026-10-06'));
});

test('库存出库：尿素用掉 0.5 袋', () => {
  reset();
  store.stock.upsert({ name: '尿素', unit: '袋', onHand: 10, warnAt: 2 });
  const card = oneCard({ reply: '', actions: [{ type: 'stock.adjust', name: '尿素', unit: '袋', qty: -0.5 }] });
  chat.execute(card);
  assert.strictEqual(store.stock.find('尿素').onHand, 9.5);
});

test('新增收入类型', () => {
  reset();
  const card = oneCard({ reply: '', actions: [{ type: 'tag.income', name: '秸秆回收' }] });
  chat.execute(card);
  assert.ok(store.db().tags.income.indexOf('秸秆回收') >= 0);
});

test('改季：播种时间/播量/整地', () => {
  reset();
  const card = oneCard({ reply: '', actions: [{ type: 'season.update', seasonId: 's1', sowDate: '2026-10-01', seedRate: 110, tillage: '免耕、深松' }] });
  chat.execute(card);
  const s = store.seasons.get('s1');
  assert.strictEqual(s.sowDate, '2026-10-01');
  assert.strictEqual(s.seedRate, 110);
  assert.strictEqual(s.tillage, '免耕、深松');
});

test('改记事：文字和操作能改，农资改量会回滚库存再重扣', () => {
  reset();
  store.stock.upsert({ name: '尿素', unit: '袋', onHand: 10 });
  store.db().tags.logStock = true;
  const log = store.logs.save({ seasonId: 's1', date: '2026-10-05', ops: ['施肥'], text: '老王帮忙', areaMu: 12, materials: [{ type: '化肥', name: '尿素', rate: 1, unit: '袋/亩' }] });
  const applied = store.stock.applyLog(log, null);
  store.logs.save({ id: log.id, stockApplied: applied });
  assert.strictEqual(store.stock.find('尿素').onHand, -2); // 10 - 12
  const card = oneCard({ reply: '', actions: [{ type: 'log.update', logId: log.id, text: '老赵帮忙', ops: ['施肥', '浇水'], materials: [{ type: '化肥', name: '尿素', rate: 0.5, unit: '袋/亩' }] }] });
  chat.execute(card);
  const l2 = store.logs.get(log.id);
  assert.strictEqual(l2.text, '老赵帮忙');
  assert.deepStrictEqual(l2.ops, ['施肥', '浇水']);
  assert.strictEqual(store.stock.find('尿素').onHand, 4); // -2 回滚 → 10，再扣 0.5×12=6 → 4
});

test('白名单之外的动作直接丢弃', () => {
  reset();
  const r = chat.fromLLM({ reply: '', actions: [{ type: 'account.hack', name: 'x' }, { type: 'cost.create' }] }, {});
  assert.strictEqual(r.cards.length, 0);
});
