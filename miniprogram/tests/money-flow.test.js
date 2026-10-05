// 收支闭环 / 欠款 / 库存 / 周期账 / 回收站 / 预算 / 资金账户 / 资产负债（node --test miniprogram/tests/*.test.js）
const test = require('node:test');
const assert = require('node:assert');

const mem = {};
global.wx = { getStorageSync: k => mem[k], setStorageSync: (k, v) => { mem[k] = v; } };
global.getApp = () => null;

const store = require('../utils/store.js');
const stats = require('../utils/stats.js');
const C = require('../utils/const.js');
const U = require('../utils/util.js');

function reset() { Object.keys(mem).forEach(k => delete mem[k]); store.replaceAll({}); }
function seed() {
  reset();
  store.plots.save({ id: 'pa', name: '村东大块', area: 52 });
  store.plots.save({ id: 'pb', name: '河边地', area: 28 });
  store.seasons.save({ id: 'sa', plotId: 'pa', crop: 'wheat', sowDate: '2026-03-01', yieldJin: 12600 });
  store.seasons.save({ id: 'sb', plotId: 'pb', crop: 'wheat', sowDate: '2026-03-01' });
}

// ---------- 收支方向与旧数据 ----------
test('旧数据没有 dir 一律算支出；收入不进成本汇总', () => {
  seed();
  store.costs.save({ id: 'c1', date: '2026-10-05', cat: 'agri', sub: '化肥', allocations: [{ seasonId: 'sa', amount: 2180 }] });
  assert.strictEqual(store.dirOf(store.costs.get('c1')), 'out');
  store.costs.save({ id: 'c2', date: '2026-10-05', dir: 'in', cat: 'grain', sub: '小麦', allocations: [{ seasonId: 'sa', amount: 15120 }] });
  assert.strictEqual(store.dirOf(store.costs.get('c2')), 'in');
  assert.strictEqual(stats.costSummary('sa').total, 2180, '成本只算支出');
  assert.strictEqual(stats.incomeSummary('sa').total, 15120);
  const n = stats.netOf('sa');
  assert.deepStrictEqual([n.income, n.expense, n.net], [15120, 2180, 12940]);
  assert.strictEqual(n.netText, '12,940');
  assert.strictEqual(C.catOf('grain').name, '卖粮', '收入类型能查到');
  assert.ok(C.iconOf('', 'grain').indexOf('_sub.svg') > 0, '收入未选中用灰图标');
  assert.ok(C.iconOf('', 'grain', 'w').indexOf('_w.svg') > 0, '收入选中用白图标');
  assert.strictEqual(C.INCOME_COLOR, '#2E5B34', '收入色复用主绿，不引入新色相');
  assert.strictEqual(C.modesFor('in')[1].key, 'perJin');
  assert.strictEqual(C.modesFor('out')[1].key, 'perMu');
  assert.strictEqual(C.catsFor('in').length, 6, '5 个收入类型 + 其他');
  assert.strictEqual(C.incomeKeyOf('卖粮'), 'grain');
  assert.strictEqual(C.incomeKeyOf('青贮'), 'inother', '自定义收入类型归到其他');
  assert.strictEqual(C.catOf('inother').name, '其他');
});

test('报表：总览/结构/趋势/按季，收入不计入支出结构', () => {
  seed();
  store.costs.save({ id: 'c1', date: '2026-10-05', cat: 'agri', sub: '化肥', allocations: [{ seasonId: 'sa', amount: 2180 }] });
  store.costs.save({ id: 'c2', date: '2026-09-20', cat: 'mach', sub: '飞防', allocations: [{ seasonId: 'sb', amount: 1500 }] });
  store.costs.save({ id: 'c3', date: '2026-10-06', dir: 'in', cat: 'grain', sub: '小麦', allocations: [{ seasonId: 'sa', amount: 15120 }] });
  const f = stats.scopeFilter('all');
  const ov = stats.overview(f);
  assert.strictEqual(ov.income, 15120);
  assert.strictEqual(ov.expense, 3680);
  assert.strictEqual(ov.net, 11440);
  assert.strictEqual(ov.area, 80, '面积按命中季去重');
  assert.strictEqual(stats.overview(stats.scopeFilter('month', { today: '2026-10-15' })).income, 15120);
  const st = stats.structureOf(f);
  assert.strictEqual(st.total, 3680, '结构里没有收入');
  assert.strictEqual(st.cats.find(x => x.key === 'agri').pct, 59.2);
  const tr = stats.monthlyTrend(4, f, '2026-10-15');
  assert.deepStrictEqual(tr.map(x => x.label), ['7月', '8月', '9月', '10月']);
  assert.strictEqual(tr[3].income, 15120);
  assert.strictEqual(tr[3].expense, 2180);
  assert.strictEqual(tr[2].expense, 1500);
  const rows = stats.bySeasonRows(f);
  assert.strictEqual(rows[0].id, 'sa', '净收益高的排前面');
  assert.strictEqual(rows[0].net, 12940);
  assert.strictEqual(rows[0].perMuNet, 249);
  assert.strictEqual(rows.find(x => x.id === 'sb').sold, false, '没收粮的季标记未收');
});

// ---------- 欠款 ----------
test('欠款：应收/应付分向、部分销账、逾期判定', () => {
  seed();
  store.costs.save({ id: 'd1', date: '2026-10-05', dir: 'in', cat: 'grain', sub: '小麦', allocations: [{ seasonId: 'sa', amount: 15120 }], debt: { party: '县城粮站', dueDate: '2026-10-03', settled: false } });
  store.costs.save({ id: 'd2', date: '2026-10-03', cat: 'mach', sub: '飞防', allocations: [{ seasonId: 'sa', amount: 1500 }], debt: { party: '老王', dueTag: '收粮后', settled: false } });
  store.costs.save({ id: 'd3', date: '2026-09-20', dir: 'in', cat: 'subsidy', sub: '种粮补贴', allocations: [{ seasonId: 'sa', amount: 3200 }], debt: { party: '农业农村局', settled: true, paidAmount: 3200 } });

  assert.strictEqual(store.costs.debts('in').length, 2, '应收 2 条（含已结清）');
  assert.strictEqual(store.costs.debtTotal('in'), 15120, '已结清不计入');
  assert.strictEqual(store.costs.debtTotal('out'), 1500);
  const ds = stats.debtSummary();
  assert.strictEqual(ds.receivable.overdueCount, 1, '10-03 约定已逾期');
  assert.strictEqual(ds.payable.rows[0].dueText, '收粮后', '相对标记原样显示');
  assert.strictEqual(ds.payable.rows[0].kind, '机械作业 · 飞防');

  // 部分销账：不结清，剩余继续挂着
  store.costs.settle('d1', { amount: 5000, date: '2026-10-07' });
  assert.strictEqual(store.costs.get('d1').debt.settled, false);
  assert.strictEqual(store.costs.debtTotal('in'), 10120);
  store.costs.settle('d1', { amount: 10120 });
  assert.strictEqual(store.costs.get('d1').debt.settled, true);
  assert.strictEqual(store.costs.debtTotal('in'), 0);
  assert.ok(store.costs.get('d1').audit.some(a => a.action === '销账'), '销账有留痕');
});

// ---------- 库存 ----------
test('库存：出入库、预警、市值', () => {
  seed();
  const a = store.stock.applyDelta('复合肥', '袋', 20, { price: 109 });
  assert.strictEqual(a.onHand, 20);
  store.stock.applyDelta('复合肥', '袋', -8);
  assert.strictEqual(store.stock.find('复合肥').onHand, 12);
  store.stock.upsert({ name: '复合肥', unit: '袋', warnAt: 15 });
  store.stock.applyDelta('济麦22', '斤', 40, { price: 3.2 });
  const s = stats.stockSummary();
  assert.strictEqual(s.count, 2);
  assert.strictEqual(s.lowCount, 1, '化肥 12 < 预警 15');
  assert.strictEqual(s.items[0].name, '复合肥', '预警的排前面');
  assert.strictEqual(s.totalValue, 1436, '12×109 + 40×3.2');
  assert.strictEqual(s.items[0].warnText, '15 袋');
  store.stock.remove('复合肥');
  assert.strictEqual(stats.stockSummary().count, 1);
});

// ---------- 周期账 ----------
test('记事农资用量联动库存：按亩数扣、编辑不重复扣、可整体关掉', () => {
  seed();
  store.stock.applyDelta('复合肥', '袋', 100, { price: 109 });
  // 52 亩 × 2 袋/亩 = 104 袋
  const log = { seasonId: 'sa', date: '2026-10-05', areaMu: 52, materials: [{ type: '化肥', name: '复合肥', rate: '2', unit: '袋/亩' }] };
  const applied = store.stock.applyLog(log, null);
  assert.deepStrictEqual(applied, [{ name: '复合肥', qty: 104 }]);
  assert.strictEqual(store.stock.find('复合肥').onHand, -4, '一百袋只够撒四十八亩，扣成负数由用户自己看');

  // 编辑成 1 袋/亩：先加回 104，再扣 52
  const log2 = Object.assign({}, log, { materials: [{ type: '化肥', name: '复合肥', rate: '1', unit: '袋/亩' }] });
  const applied2 = store.stock.applyLog(log2, applied);
  assert.deepStrictEqual(applied2, [{ name: '复合肥', qty: 52 }]);
  assert.strictEqual(store.stock.find('复合肥').onHand, 48, '100 − 52');

  // 库存里没有同名品名 → 跳过（不自动新建）
  assert.strictEqual(store.stock.applyLog(Object.assign({}, log, { materials: [{ name: '不存在的东西', rate: '3' }] }), null), null);
  // 没填面积 → 跳过
  assert.strictEqual(store.stock.applyLog(Object.assign({}, log, { areaMu: '' }), null), null);

  // 关掉开关后不再扣
  store.tags.setLogStock(false);
  assert.strictEqual(store.stock.applyLog(log, null), null);
  assert.strictEqual(store.stock.find('复合肥').onHand, 48);
  store.tags.setLogStock(true);
});

test('周期账：按月/季/年/周到期，fire 后不再重复到期', () => {
  seed();
  const m = store.recurring.save({ name: '土地流转', freq: 'month', day: 1, cat: 'asset', sub: '土地流转', mode: 'fixed', amount: 1800, startAt: '2026-01-01' });
  assert.strictEqual(store.recurring.dueOn(m, '2026-11-01'), true);
  assert.strictEqual(store.recurring.dueOn(m, '2026-11-02'), false);
  assert.strictEqual(store.recurring.dueOn(m, '2025-12-01'), false, '未到起点');
  store.recurring.fire(m.id, '2026-11-01');
  assert.strictEqual(store.recurring.dueOn(store.recurring.get(m.id), '2026-11-01'), false, '记过就不再提醒');
  assert.strictEqual(store.recurring.dueOn(store.recurring.get(m.id), '2026-12-01'), true);

  const q = store.recurring.save({ name: '贷款', freq: 'quarter', day: 5, startAt: '2026-01-01' });
  assert.strictEqual(store.recurring.dueOn(q, '2026-07-05'), true);
  assert.strictEqual(store.recurring.dueOn(q, '2026-08-05'), false);
  const y = store.recurring.save({ name: '租金年付', freq: 'year', day: 3, startAt: '2026-01-01' });
  assert.strictEqual(store.recurring.dueOn(y, '2027-01-03'), true);
  const w = store.recurring.save({ name: '周账', freq: 'week', day: 1, startAt: '2026-01-01' });
  assert.strictEqual(store.recurring.dueOn(w, '2026-11-02'), true, '2026-11-02 是周一');
  assert.strictEqual(store.recurring.dueOn(w, '2026-11-03'), false);
  // 停用后不再到期
  store.recurring.save(Object.assign({}, w, { enabled: false }));
  assert.strictEqual(store.recurring.dueOn(store.recurring.get(w.id), '2026-11-09'), false);
  // 待记列表：只有真正到期的才进来
  store.recurring.save({ name: '农资贷款', freq: 'month', day: 5, cat: 'asset', startAt: '2026-01-01' });
  assert.strictEqual(stats.recurringDue('2026-11-02').length, 0, 'day=5 的没到 11-05');
  const due = stats.recurringDue('2026-11-05');
  assert.strictEqual(due.length, 1);
  assert.strictEqual(due[0].freqName, '每月');
  assert.strictEqual(due[0].dirName, '支出');
});

// ---------- 回收站 ----------
test('回收站：软删不进统计、可恢复、留痕、到期清理', () => {
  seed();
  store.costs.save({ id: 'c1', date: '2026-10-05', cat: 'agri', sub: '化肥', allocations: [{ seasonId: 'sa', amount: 2180 }] });
  store.costs.remove('c1');
  assert.strictEqual(store.costs.expense().length, 0, '软删后不在流水里');
  assert.strictEqual(stats.costSummary('sa').total, 0, '软删后不算成本');
  assert.strictEqual(store.trash.count(), 1);
  const row = store.trash.all()[0];
  assert.strictEqual(row.col, 'costs');
  assert.strictEqual(row.title, '农资投入 · 化肥 ¥2,180');
  assert.strictEqual(row.daysLeft, 30);

  store.trash.restore('costs', 'c1');
  assert.strictEqual(store.costs.expense().length, 1);
  assert.strictEqual(store.trash.count(), 0);
  assert.ok(store.costs.get('c1').audit.some(a => a.action === '删除'));
  assert.ok(store.costs.get('c1').audit.some(a => a.action === '恢复'));

  // 记事软删同理
  store.logs.save({ id: 'l1', seasonId: 'sa', date: '2026-10-05', ops: ['施肥'], text: '复合肥 20 袋' });
  store.logs.remove('l1');
  assert.strictEqual(store.logs.bySeason('sa').length, 0);
  assert.strictEqual(store.trash.count(), 1);
  assert.ok(store.trash.all()[0].title.indexOf('记事') === 0);

  // 到期真删：手工把 deletedAt 拨回 31 天前，replaceAll 触发 migrate 清理
  const dump = JSON.parse(JSON.stringify(store.db()));
  dump.logs[0].deletedAt = Date.now() - 31 * 86400000;
  store.replaceAll(dump);
  assert.strictEqual(store.trash.count(), 0, '超过 30 天本机清理');
});

// ---------- 日历 / 周历 ----------
test('账本日历：收支分色、未记判定、周历 7 格与小计', () => {
  seed();
  store.costs.save({ id: 'c1', date: '2026-10-05', cat: 'agri', sub: '化肥', allocations: [{ seasonId: 'sa', amount: 2180 }] });
  store.costs.save({ id: 'c2', date: '2026-10-05', dir: 'in', cat: 'grain', sub: '小麦', allocations: [{ seasonId: 'sa', amount: 15120 }] });
  store.logs.save({ id: 'l1', seasonId: 'sa', date: '2026-10-08', ops: ['巡田'] });
  const cal = stats.costMonth(store.seasons.get('sa'), '2026-10');
  const c5 = cal.cells.find(c => c.date === '2026-10-05');
  assert.strictEqual(c5.spend, 2180);
  assert.strictEqual(c5.income, 15120);
  assert.strictEqual(c5.incomeText, '1.5万');
  assert.strictEqual(c5.unrecorded, false, '有记账就不算未记');
  assert.strictEqual(cal.cells.find(c => c.date === '2026-10-04').unrecorded, true, '过去、在季、没记没账');
  assert.strictEqual(cal.cells.find(c => c.date === '2026-10-06').unrecorded, false, '未来日期不提示未记');
  assert.strictEqual(cal.cells.find(c => c.date === '2026-10-08').hasLog, true);
  assert.strictEqual(cal.monthIncome, 15120);
  assert.strictEqual(cal.monthNet, 12940);

  const wk = stats.costWeek(store.seasons.get('sa'), stats.weekStartOf('2026-10-05'));
  assert.strictEqual(wk.cells.length, 7);
  assert.strictEqual(wk.cells[0].date, '2026-10-04', '周日打头');
  assert.strictEqual(wk.income, 15120);
  assert.strictEqual(wk.expense, 2180);
  assert.strictEqual(wk.net, 12940);
  assert.strictEqual(wk.title, '10/4 – 10/10');

  const ms = stats.monthSpend('2026-10');
  assert.strictEqual(ms.income, 15120);
  assert.strictEqual(ms.total, 2180);
  assert.strictEqual(ms.net, 12940);
});

test('流水多维筛选：方向/类型/细分/金额/时间/赊账/附件/地块/关键词', () => {
  seed();
  store.costs.save({ id: 's1', date: '2026-10-05', cat: 'agri', sub: '化肥', allocations: [{ seasonId: 'sa', amount: 2180 }], note: '复合肥 20 袋', attachments: [{ name: '收据.jpg' }] });
  store.costs.save({ id: 's2', date: '2026-09-20', cat: 'mach', sub: '飞防', allocations: [{ seasonId: 'sb', amount: 1500 }], debt: { party: '老王', settled: false } });
  store.costs.save({ id: 's3', date: '2026-10-06', dir: 'in', cat: 'grain', sub: '小麦', allocations: [{ seasonId: 'sa', amount: 15120 }], debt: { party: '县城粮站', settled: true } });
  const F = f => store.costs.all(c => stats.matchesFilter(c, f, f.q)).map(c => c.id);

  assert.strictEqual(F({}).length, 3, '空条件全通过');
  assert.deepStrictEqual(F({ dir: 'in' }), ['s3']);
  assert.deepStrictEqual(F({ dir: 'all' }), ['s3', 's1', 's2'], 'all 等于不过滤方向（按日期倒序）');
  assert.deepStrictEqual(F({ cats: ['agri', 'mach'] }), ['s1', 's2']);
  assert.deepStrictEqual(F({ subs: ['化肥'] }), ['s1']);
  assert.deepStrictEqual(F({ amtMin: 2000, amtMax: 20000 }), ['s3', 's1']);
  assert.deepStrictEqual(F({ from: '2026-10-01', to: '2026-10-31' }), ['s3', 's1']);
  assert.deepStrictEqual(F({ onlyDebt: true }), ['s2'], '已结清的不算欠款');
  assert.deepStrictEqual(F({ onlyAttach: true }), ['s1']);
  assert.deepStrictEqual(F({ plotId: 'pb' }), ['s2'], '按地块筛');
  assert.deepStrictEqual(F({ seasonId: 'sa' }), ['s3', 's1']);
  assert.deepStrictEqual(F({ q: '老王' }), ['s2'], '搜对方');
  assert.deepStrictEqual(F({ q: '复合肥' }), ['s1'], '搜备注');
  assert.strictEqual(F({ dir: 'out', cats: ['agri'], amtMin: 3000 }).length, 0, '多条件取交集');
});

test('连续补账：找出区间里没记事也没记账的日子', () => {
  seed();
  store.costs.save({ id: 'c1', date: '2026-10-05', cat: 'agri', sub: '化肥', allocations: [{ seasonId: 'sa', amount: 100 }] });
  store.logs.save({ id: 'l1', seasonId: 'sa', date: '2026-10-06', ops: ['巡田'] });
  assert.deepStrictEqual(stats.missingDays('2026-10-04', '2026-10-08', ''), ['2026-10-04', '2026-10-07', '2026-10-08']);
  store.costs.save({ id: 'c2', date: '2026-10-09', cat: 'agri', sub: '化肥', allocations: [{ seasonId: 'sb', amount: 100 }] });
  assert.deepStrictEqual(stats.missingDays('2026-10-09', '2026-10-09', 'sa'), ['2026-10-09'], '其他季的账不算数');
  assert.deepStrictEqual(stats.missingDays('2026-10-09', '2026-10-09', 'sb'), []);
  store.logs.remove('l1');
  assert.strictEqual(stats.missingDays('2026-10-06', '2026-10-06', '').length, 1, '软删的记事不算记过');
});

// ---------- 流水按日分组 ----------
test('流水按日分组带收入/支出/净额', () => {
  seed();
  store.costs.save({ id: 'c1', date: '2026-10-05', cat: 'agri', sub: '化肥', allocations: [{ seasonId: 'sa', amount: 2180 }] });
  store.costs.save({ id: 'c2', date: '2026-10-05', dir: 'in', cat: 'grain', sub: '小麦', allocations: [{ seasonId: 'sa', amount: 15120 }] });
  const days = stats.costDays(store.seasons.get('sa'));
  assert.strictEqual(days[0].income, 15120);
  assert.strictEqual(days[0].expense, 2180);
  assert.strictEqual(days[0].net, 12940);
  assert.strictEqual(days[0].items.length, 2);
});

// ---------- 常用账（收入） ----------
test('收入类型：可增删改名，改名同步历史流水', () => {
  seed();
  assert.ok(store.tags.income().indexOf('卖粮') >= 0);
  assert.strictEqual(store.tags.addIncome('青贮'), true);
  assert.strictEqual(store.tags.addIncome('青贮'), false, '不重复加');
  store.costs.save({ id: 'c1', date: '2026-10-05', dir: 'in', cat: 'grain', sub: '青贮', allocations: [{ seasonId: 'sa', amount: 3000 }] });
  store.tags.renameIncome('青贮', '青贮玉米');
  assert.strictEqual(store.costs.get('c1').sub, '青贮玉米');
  store.tags.removeIncome('青贮玉米');
  assert.strictEqual(store.tags.income().indexOf('青贮玉米'), -1);
});

// ---------- 预算 ----------
test('预算：总预算优先，缺省按每亩目标×面积折算，超支能判出来', () => {
  seed();
  store.seasons.setBudget('sa', { total: 0, perMu: 100 });
  let bp = stats.budgetProgress('sa');
  assert.strictEqual(store.seasons.budget('sa').perMu, 100);
  assert.strictEqual(bp.hasBudget, true);
  assert.strictEqual(bp.total, 5200, '100 元/亩 × 52 亩');
  store.costs.save({ id: 'b1', date: '2026-10-05', cat: 'agri', sub: '化肥', allocations: [{ seasonId: 'sa', amount: 5400 }] });
  bp = stats.budgetProgress('sa');
  assert.strictEqual(bp.spent, 5400);
  assert.strictEqual(bp.over, true);
  assert.strictEqual(bp.remainText, '200');
  assert.strictEqual(bp.perMuOver, true, '每亩也超了目标');
  store.seasons.setBudget('sa', { total: 8000, perMu: 100 });
  bp = stats.budgetProgress('sa');
  assert.strictEqual(bp.total, 8000, '填了总预算就按总预算，不再折算');
  assert.strictEqual(bp.over, false);
  assert.strictEqual(bp.pct, 67.5);
  assert.strictEqual(stats.budgetAlerts().length, 0, '没到 90% 不提醒');
  store.seasons.setBudget('sa', { total: 6000 });
  assert.strictEqual(stats.budgetAlerts()[0].seasonId, 'sa', '超过 90% 就提醒');
});

// ---------- 资金账户 ----------
test('资金账户：余额 = 期初 + 实收 − 实付；赊账只算已销账部分；没挂账户的不计入', () => {
  seed();
  store.accounts.save([{ key: 'cash', name: '现金', init: 1000 }, { key: 'wechat', name: '微信', init: 0 }]);
  assert.strictEqual(store.accounts.name('cash'), '现金');
  store.costs.save({ id: 'f1', date: '2026-10-05', cat: 'agri', sub: '化肥', account: 'cash', allocations: [{ seasonId: 'sa', amount: 300 }] });
  store.costs.save({ id: 'f2', date: '2026-10-05', dir: 'in', cat: 'grain', sub: '小麦', account: 'cash', allocations: [{ seasonId: 'sa', amount: 5000 }] });
  store.costs.save({ id: 'f3', date: '2026-10-05', cat: 'mach', sub: '播种', account: 'wechat', allocations: [{ seasonId: 'sa', amount: 200 }] });
  store.costs.save({ id: 'f4', date: '2026-10-05', cat: 'agri', sub: '农药', allocations: [{ seasonId: 'sa', amount: 99 }] });
  store.costs.save({ id: 'f5', date: '2026-10-05', dir: 'in', cat: 'grain', sub: '小麦', account: 'cash', allocations: [{ seasonId: 'sa', amount: 2000 }], debt: { party: '粮站', settled: false, paidAmount: 0 } });
  let r = stats.accountRows();
  assert.strictEqual(r.rows.find(x => x.key === 'cash').balance, 5700, '1000 + 5000 − 300，未收的 2000 不进余额');
  assert.strictEqual(r.rows.find(x => x.key === 'wechat').balance, -200);
  assert.strictEqual(r.noAccount, 1);
  assert.strictEqual(r.totalBalance, 5500);
  assert.strictEqual(stats.matchesFilter(store.costs.get('f1'), { account: 'cash' }, ''), true);
  assert.strictEqual(stats.matchesFilter(store.costs.get('f3'), { account: 'cash' }, ''), false);
  store.costs.settle('f5', { amount: 2000 });
  r = stats.accountRows();
  assert.strictEqual(r.rows.find(x => x.key === 'cash').balance, 7700, '销账后才进账户');
});

// ---------- 资产负债总览 ----------
test('资产负债：净资产 = 账户余额 + 库存估值 + 应收 − 应付', () => {
  seed();
  store.accounts.save([{ key: 'cash', name: '现金', init: 5000 }]);
  store.stock.upsert({ name: '化肥', unit: '袋', onHand: 10, lastPrice: 120 });
  store.costs.save({ id: 'a1', date: '2026-10-05', dir: 'in', cat: 'grain', sub: '小麦', account: 'cash', allocations: [{ seasonId: 'sa', amount: 3000 }], debt: { party: '粮站', settled: false, paidAmount: 0 } });
  store.costs.save({ id: 'a2', date: '2026-10-05', cat: 'mach', sub: '收获', account: 'cash', allocations: [{ seasonId: 'sa', amount: 800 }], debt: { party: '老王', settled: false, paidAmount: 0 } });
  const bs = stats.balanceSheet();
  assert.strictEqual(bs.cash, 5000, '赊账还没动钱');
  assert.strictEqual(bs.stockValue, 1200);
  assert.strictEqual(bs.receivable, 3000);
  assert.strictEqual(bs.payable, 800);
  assert.strictEqual(bs.assets, 5000 + 1200 + 3000);
  assert.strictEqual(bs.liabilities, 800);
  assert.strictEqual(bs.net, 5000 + 1200 + 3000 - 800);
});
