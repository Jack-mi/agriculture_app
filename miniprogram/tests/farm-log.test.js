// 农事日志与成本分摊 · 最小用例（node --test miniprogram/tests/）
// 用内存 stub 顶替 wx Storage，直接跑 store/stats 的纯逻辑
const test = require('node:test');
const assert = require('node:assert');

const mem = {};
global.wx = {
  getStorageSync: k => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; }
};
global.getApp = () => null;

const store = require('../utils/store.js');
const stats = require('../utils/stats.js');
const U = require('../utils/util.js');

function reset() {
  Object.keys(mem).forEach(k => delete mem[k]);
  store.replaceAll({});
}
function seedPlot() {
  store.plots.save({ id: 'p1', name: '北地', area: 100 });
}

test('旧单季成本自动迁移，本季统计金额不变', () => {
  reset(); seedPlot();
  store.seasons.save({ id: 's1', plotId: 'p1', crop: 'corn', sowDate: '2026-06-01' });
  // 旧格式：无 allocations，直接 seasonId + amount
  store.db().costs.push({ id: 'c1', seasonId: 's1', date: '2026-06-02', cat: 'mach', sub: '播种', amount: 3000, createdAt: 1, updatedAt: 1 });
  assert.strictEqual(stats.costSummary('s1').total, 3000);
  assert.strictEqual(store.costs.bySeason('s1').length, 1);
  assert.strictEqual(store.costs.amountFor(store.db().costs[0], 's1'), 3000);
});

test('4800 元分摊 2000/2800，两季各计各的，合计 4800', () => {
  reset(); seedPlot();
  store.seasons.save({ id: 's1', plotId: 'p1', crop: 'corn', sowDate: '2026-06-01' });
  store.seasons.save({ id: 's2', plotId: 'p1', crop: 'wheat', sowDate: '2025-10-01', status: 'done', harvestDate: '2026-06-10' });
  const c = store.costs.save({ seasonId: 's1', date: '2026-07-02', cat: 'mach', sub: '播种', allocations: [{ seasonId: 's1', amount: 2000 }, { seasonId: 's2', amount: 2800 }] });
  assert.strictEqual(c.amount, 4800);
  assert.strictEqual(stats.costSummary('s1').total, 2000);
  assert.strictEqual(stats.costSummary('s2').total, 2800);
  assert.strictEqual(store.costs.allocOf(c).length, 2);
});

test('删除一个分摊季后，另一季仍看到剩余分摊；删光后整笔删除', () => {
  reset(); seedPlot();
  store.seasons.save({ id: 's1', plotId: 'p1', crop: 'corn', sowDate: '2026-06-01' });
  store.seasons.save({ id: 's2', plotId: 'p1', crop: 'wheat', sowDate: '2025-10-01', status: 'done', harvestDate: '2026-06-10' });
  const c = store.costs.save({ seasonId: 's1', date: '2026-07-02', cat: 'mach', sub: '播种', allocations: [{ seasonId: 's1', amount: 2000 }, { seasonId: 's2', amount: 2800 }] });
  store.seasons.remove('s2');
  const kept = store.costs.get(c.id);
  assert.ok(kept, '账目应保留');
  assert.strictEqual(kept.amount, 2000);
  assert.strictEqual(stats.costSummary('s1').total, 2000);
  store.seasons.remove('s1');
  assert.strictEqual(store.costs.get(c.id), undefined);
});

test('全生育周期日历连续不断档（跨年冬小麦），无记录日期标记缺记', () => {
  reset(); seedPlot();
  const s = store.seasons.save({ id: 's1', plotId: 'p1', crop: 'wheat', sowDate: '2025-10-01', status: 'done', harvestDate: '2026-06-10' });
  const cal = stats.logCalendar(s);
  assert.strictEqual(cal.length, U.diffDays('2025-10-01', '2026-06-10') + 1);
  assert.strictEqual(cal[0].date, '2025-10-01');
  assert.strictEqual(cal[cal.length - 1].date, '2026-06-10');
  for (let i = 1; i < cal.length; i++) {
    assert.strictEqual(U.diffDays(cal[i - 1].date, cal[i].date), 1, '日期必须连续');
  }
  assert.ok(cal.every(d => d.empty), '全部缺记');
  store.logs.save({ seasonId: 's1', date: '2025-10-01', ops: ['播种'], text: '' });
  const cal2 = stats.logCalendar(store.seasons.get('s1'));
  assert.strictEqual(cal2[0].empty, false);
  assert.strictEqual(cal2[0].logs.length, 1);
});

test('旧施肥记录映射为化肥使用明细', () => {
  assert.deepStrictEqual(store.logs.materialsOf({ fertName: '尿素', fertRate: 80 }),
    [{ type: '化肥', name: '尿素', rate: 80, unit: '斤/亩' }]);
  assert.deepStrictEqual(store.logs.materialsOf({}), []);
  // 新结构优先
  assert.deepStrictEqual(
    store.logs.materialsOf({ fertName: '旧值', materials: [{ type: '种子', name: '济麦22', rate: 4200, unit: '株/亩' }] }),
    [{ type: '种子', name: '济麦22', rate: 4200, unit: '株/亩' }]);
});

test('手工修正的风力不被 API 覆盖，API 新日期带风力', () => {
  reset(); seedPlot();
  store.weather.setManual('p1', '2026-07-01', 25, 3, 8.5);
  store.weather.putApi('p1', { '2026-07-01': { t: 26, p: 0, wind: 12 } });
  const w1 = store.weather.get('p1', '2026-07-01');
  assert.strictEqual(w1.src, 'manual');
  assert.strictEqual(w1.wind, 8.5);
  store.weather.putApi('p1', { '2026-07-02': { t: 27, p: 1, wind: 6 } });
  assert.strictEqual(store.weather.get('p1', '2026-07-02').wind, 6);
  // 统计：风力取全周期最大，不累计
  store.seasons.save({ id: 's1', plotId: 'p1', crop: 'corn', sowDate: '2026-07-01', status: 'done', harvestDate: '2026-07-02' });
  const ws = stats.weatherSeries(store.seasons.get('s1'));
  assert.strictEqual(ws.maxWind, 8.5);
  assert.strictEqual(ws.rows[0].wind, 8.5);
  assert.strictEqual(ws.rows[1].wind, 6);
});

test('默认记事类型补齐（播种/收获/病虫害观察）', () => {
  reset();
  const names = store.tags.log().map(t => t.name);
  ['播种', '收获', '病虫害观察', '施肥'].forEach(n => assert.ok(names.indexOf(n) >= 0, n));
});
