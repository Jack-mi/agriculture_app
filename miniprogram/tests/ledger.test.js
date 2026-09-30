// 随手记式记账 P0/P1 用例（node --test miniprogram/tests/）
const test = require('node:test');
const assert = require('node:assert');

const mem = {};
global.wx = { getStorageSync: k => mem[k], setStorageSync: (k, v) => { mem[k] = v; } };
global.getApp = () => null;

const store = require('../utils/store.js');
const stats = require('../utils/stats.js');
const K = require('../utils/keypad.js');
const U = require('../utils/util.js');

function reset() { Object.keys(mem).forEach(k => delete mem[k]); store.replaceAll({}); }
function seed() {
  reset();
  store.plots.save({ id: 'pa', name: '村东大块', area: 52 });
  store.plots.save({ id: 'pb', name: '河边地', area: 28 });
  store.seasons.save({ id: 'sa', plotId: 'pa', crop: 'corn', sowDate: '2026-06-17' });
  store.seasons.save({ id: 'sb', plotId: 'pb', crop: 'wheat', sowDate: '2025-10-08', status: 'done', harvestDate: '2026-06-10' });
}

// ---------- 键盘 ----------
test('键盘：连加求值、运算符替换、两位小数、前导 0', () => {
  let e = '';
  ['3', '2', '0', '+', '1', '8', '0', '+', '9', '5'].forEach(k => { e = K.press(e, k); });
  assert.strictEqual(e, '320+180+95');
  assert.strictEqual(K.evalExpr(e), 595);
  assert.ok(K.hasOp(e));
  assert.strictEqual(K.press('12+', '-'), '12-');          // 连按运算符替换
  assert.strictEqual(K.press('', '+'), '');                 // 不能以运算符开头
  assert.strictEqual(K.press('1.25', '9'), '1.25');         // 两位小数
  assert.strictEqual(K.press('1.2', '.'), '1.2');           // 一段只能一个小数点
  assert.strictEqual(K.press('', '.'), '0.');
  assert.strictEqual(K.press('0', '5'), '5');               // 去前导 0
  assert.strictEqual(K.press('12', 'del'), '1');
  assert.strictEqual(K.evalExpr('100-30.5'), 69.5);
  assert.strictEqual(K.evalExpr('10-50'), 0);               // 负数归 0
  assert.strictEqual(K.evalExpr('88+'), 88);                // 尾随运算符忽略
  assert.strictEqual(K.press('9999999', '9'), '9999999');   // 上限
});

// ---------- 分摊 ----------
test('按亩均摊：15元/亩×80亩 = 1200 → 52亩 780 / 28亩 420', () => {
  seed();
  const a = store.costs.allocByArea(1200, ['sa', 'sb']);
  assert.deepStrictEqual(a, [{ seasonId: 'sa', amount: 780 }, { seasonId: 'sb', amount: 420 }]);
  assert.strictEqual(store.costs.areaOf(['sa', 'sb']), 80);
});

test('均摊尾差由最后一季吸收，合计恒等于总额', () => {
  const parts = store.costs.splitBy(100, [1, 1, 1]);
  assert.deepStrictEqual(parts, [33.33, 33.33, 33.34]);
  assert.strictEqual(Math.round(parts.reduce((a, b) => a + b, 0) * 100), 10000);
  const p2 = store.costs.splitBy(1000.01, [52, 28, 35]);
  assert.strictEqual(Math.round(p2.reduce((a, b) => a + b, 0) * 100), 100001);
  // 面积都为 0 → 退化为平均
  assert.deepStrictEqual(store.costs.splitBy(10, [0, 0]), [5, 5]);
});

test('按亩计的账：calc / split 落库，统计仍按分摊金额', () => {
  seed();
  const c = store.costs.save({
    seasonId: 'sa', date: '2026-09-28', cat: 'mach', sub: '飞防',
    allocations: store.costs.allocByArea(1200, ['sa', 'sb']),
    calc: { mode: 'perMu', unitPrice: 15, mu: 80 }, split: 'area'
  });
  assert.strictEqual(c.amount, 1200);
  assert.strictEqual(stats.costSummary('sa').total, 780);
  assert.strictEqual(stats.costSummary('sb').total, 420);
  assert.strictEqual(stats.calcText(store.costs.get(c.id)), '¥15/亩 × 80亩');
  assert.strictEqual(stats.calcText({ expr: '320+180' }), '320+180');
  assert.strictEqual(stats.calcText({ people: 3, unitPrice: 200 }), '3人 × ¥200');   // 旧雇工记录
});

// ---------- 流水按日 / 日历 ----------
test('costDays：按日分组倒序，组合计按本季分摊口径', () => {
  seed();
  store.costs.save({ seasonId: 'sa', date: '2026-09-28', cat: 'mach', sub: '飞防', allocations: [{ seasonId: 'sa', amount: 780 }, { seasonId: 'sb', amount: 420 }] });
  store.costs.save({ seasonId: 'sa', date: '2026-09-28', cat: 'agri', sub: '农药', allocations: [{ seasonId: 'sa', amount: 1320 }] });
  store.costs.save({ seasonId: 'sa', date: '2026-09-20', cat: 'labor', sub: '按天用工', allocations: [{ seasonId: 'sa', amount: 600 }] });
  const days = stats.costDays(store.seasons.get('sa'));
  assert.deepStrictEqual(days.map(d => d.date), ['2026-09-28', '2026-09-20']);
  assert.strictEqual(days[0].total, 2100);
  assert.strictEqual(days[0].items.length, 2);
  assert.strictEqual(days[0].dayN, U.diffDays('2026-06-17', '2026-09-28') + 1);
  const only = stats.costDays(store.seasons.get('sa'), c => c.sub === '飞防');
  assert.strictEqual(only.length, 1);
  assert.strictEqual(only[0].total, 780);
});

test('costMonth：周日起始整周网格、季外置灰、未记标记、月合计', () => {
  seed();
  const s = store.seasons.get('sb'); // 2025-10-08 → 2026-06-10
  store.costs.save({ seasonId: 'sb', date: '2025-10-08', cat: 'agri', sub: '种子', allocations: [{ seasonId: 'sb', amount: 2016 }] });
  store.logs.save({ seasonId: 'sb', date: '2025-10-09', ops: ['巡田'], text: '' });
  store.weather.putApi('pb', { '2025-10-10': { t: 15, p: 6, wind: 3 } });
  const m = stats.costMonth(s, '2025-10');
  assert.strictEqual(m.cells.length % 7, 0);
  assert.strictEqual(new Date(m.cells[0].date.replace(/-/g, '/')).getDay(), 0);
  const cell = d => m.cells.find(c => c.date === d);
  assert.strictEqual(cell('2025-10-07').inSeason, false);        // 播种前
  assert.strictEqual(cell('2025-10-08').spend, 2016);
  assert.strictEqual(cell('2025-10-08').big, true);
  assert.strictEqual(cell('2025-10-08').spendText, '2,016');
  assert.strictEqual(cell('2025-10-09').hasLog, true);
  assert.strictEqual(cell('2025-10-09').unrecorded, false);
  assert.strictEqual(cell('2025-10-10').rain, true);
  assert.strictEqual(cell('2025-10-10').unrecorded, true);
  assert.strictEqual(m.monthTotal, 2016);
  assert.strictEqual(m.canPrev, false);
  assert.strictEqual(m.canNext, true);
  // 跨年翻月连续
  assert.strictEqual(stats.shiftYm('2025-12', 1), '2026-01');
  assert.strictEqual(stats.shiftYm('2026-01', -1), '2025-12');
  const last = stats.costMonth(s, '2026-06');
  assert.strictEqual(last.canNext, false);
  assert.strictEqual(last.cells.find(c => c.date === '2026-06-11').inSeason, false); // 收获后
  assert.strictEqual(stats.shortMoney(12345), '1.2万');
});

test('monthSpend：全部地块本月合计，多季共用不重复计', () => {
  seed();
  const t = U.today();
  store.costs.save({ seasonId: 'sa', date: t, cat: 'mach', sub: '飞防', allocations: [{ seasonId: 'sa', amount: 780 }, { seasonId: 'sb', amount: 420 }] });
  const ms = stats.monthSpend(t.slice(0, 7));
  assert.strictEqual(ms.total, 1200);
  assert.strictEqual(ms.today, 1200);
});

// ---------- 常用账 ----------
test('常用账：增改删排序，入 outbox，恢复默认类型不丢常用账', () => {
  seed();
  const a = store.tags.saveTemplate({ name: '无人机飞防', cat: 'mach', sub: '飞防', mode: 'perMu', unitPrice: 15, split: 'area' });
  const b = store.tags.saveTemplate({ name: '雇工', cat: 'labor', sub: '按天用工', mode: 'perDay', unitPrice: 200, people: 3 });
  assert.strictEqual(store.tags.templates().length, 2);
  assert.strictEqual(stats.tplDesc(a), '¥15/亩 · 按亩均摊');
  assert.strictEqual(stats.tplDesc(b), '¥200/人·天 × 3人');
  store.tags.saveTemplate(Object.assign({}, a, { unitPrice: 18 }));
  assert.strictEqual(store.tags.template(a.id).unitPrice, 18);
  store.tags.moveTemplate(b.id, -1);
  assert.strictEqual(store.tags.templates()[0].id, b.id);
  assert.ok(store.outbox().some(e => e.col === 'tags'));
  store.tags.resetDefault();
  assert.strictEqual(store.tags.templates().length, 2);
  store.tags.removeTemplate(a.id);
  assert.strictEqual(store.tags.templates().length, 1);
  assert.strictEqual(store.tags.saveTemplate({ name: ' ' }), null);
});

test('品种（二级类目）：选填落库，快捷选项 = 用过的在前 + 内置常见品种，去重', () => {
  seed();
  // 不填品种也能开季，brief 不带品种
  assert.strictEqual(stats.seasonBrief(store.seasons.get('sa')).cropFull, '玉米');
  store.seasons.save({ id: 'sa', variety: '登海605' });
  store.seasons.save({ id: 'sc', plotId: 'pb', crop: 'corn', sowDate: '2024-06-15', variety: '自留种' });
  const b = stats.seasonBrief(store.seasons.get('sa'));
  assert.strictEqual(b.variety, '登海605');
  assert.strictEqual(b.cropFull, '玉米 · 登海605');
  const v = store.seasons.varieties('corn');
  assert.deepStrictEqual(v.used, ['登海605', '自留种']);
  assert.ok(v.preset.indexOf('登海605') < 0, '用过的不重复出现在建议里');
  assert.ok(v.preset.indexOf('郑单958') >= 0);
  assert.deepStrictEqual(store.seasons.varieties('wheat').used, []);
  // 清空
  store.seasons.save({ id: 'sa', variety: '' });
  assert.strictEqual(stats.seasonBrief(store.seasons.get('sa')).cropFull, '玉米');
});

test('记事类型带"要填的项"：默认类型有 fields，老库自动补齐，自定义类型默认只填具体情况', () => {
  reset();
  const t = n => store.tags.logTag(n);
  assert.deepStrictEqual(t('施肥').fields, ['mat', 'machine', 'area']);
  assert.strictEqual(t('施肥').matType, '化肥');
  assert.ok(t('打药').fields.indexOf('pest') >= 0);
  assert.ok(t('巡田').fields.indexOf('growth') >= 0);
  assert.deepStrictEqual(t('其他').fields, []);
  // 老库：记事类型没有 fields 字段
  mem[store.KEY] = { plots: [], seasons: [], costs: [], logs: [], weather: {}, tags: { cost: {}, log: [{ name: '施肥', color: '#000' }, { name: '镇压', color: '#111' }] } };
  store.replaceAll(mem[store.KEY]);
  assert.deepStrictEqual(t('施肥').fields, ['mat', 'machine', 'area']);
  assert.deepStrictEqual(t('镇压').fields, []);
  store.tags.addLog({ name: '中耕' });
  assert.deepStrictEqual(t('中耕').fields, []);
  store.tags.updateLog('中耕', { fields: ['machine', 'area'] });
  assert.deepStrictEqual(t('中耕').fields, ['machine', 'area']);
});

test('旧库无 templates / calc / expr 字段时正常读取', () => {
  reset();
  mem[store.KEY] = { plots: [], seasons: [], costs: [], logs: [], weather: {}, tags: { cost: { agri: ['种子'] }, log: [] } };
  store.replaceAll(mem[store.KEY]);
  assert.deepStrictEqual(store.tags.templates(), []);
});
