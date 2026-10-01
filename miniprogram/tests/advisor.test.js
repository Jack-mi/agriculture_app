// 农事参谋：生育期 / 规则任务 / 预警 / 本地语义解析 / 对话动作
const test = require('node:test');
const assert = require('node:assert');

const mem = {};
global.wx = { getStorageSync: k => mem[k], setStorageSync: (k, v) => { mem[k] = v; } };
global.getApp = () => null;

const U = require('../utils/util.js');
const store = require('../utils/store.js');
const growth = require('../utils/growth.js');
const advisor = require('../utils/advisor.js');
const chat = require('../utils/chat.js');
const pesticide = require('../utils/pesticide.js');

const T = U.today();
const D = n => U.addDays(T, n);
function reset() { Object.keys(mem).forEach(k => delete mem[k]); store.replaceAll({}); }
function fillWeather(plotId, from, to, t, p) {
  const map = {}; U.range(from, to).forEach(d => { map[d] = { t, p: p || 0 }; });
  store.weather.putApi(plotId, map, { fromCloud: true });
}
function seedWheat(daysAgo, t) {
  reset();
  store.plots.save({ id: 'pb', name: '河边地', area: 28, lat: 37.1, lng: 122.4 });
  store.seasons.save({ id: 'sw', plotId: 'pb', crop: 'wheat', variety: '济麦22', sowDate: D(-daysAgo) });
  fillWeather('pb', D(-daysAgo), T, t);
  return store.seasons.get('sw');
}
function setFc(plotId, days) { mem['guyuji_fc_' + plotId] = { date: T, days }; }

// ---------- 生育期 ----------
test('有效积温：小麦基温 0、玉米基温 10 且 30℃ 封顶', () => {
  assert.strictEqual(growth.dayGdd('wheat', 15), 15);
  assert.strictEqual(growth.dayGdd('wheat', -3), 0);
  assert.strictEqual(growth.dayGdd('corn', 25), 15);
  assert.strictEqual(growth.dayGdd('corn', 35), 20);
  assert.strictEqual(growth.dayGdd('corn', 8), 0);
});

test('生育期推算 + 预测下一阶段日期 + 校准偏移', () => {
  const s = seedWheat(9, 15); // 10 天 × 15 = 150 → 出苗期（120），下一阶段三叶 220
  const c = growth.current(s, []);
  assert.strictEqual(c.stage.key, 'emerge');
  assert.strictEqual(c.next.key, 'leaf3');
  assert.strictEqual(c.gdd, 150);
  assert.ok(c.eta > T, '有预测日期');
  const fc = U.range(D(1), D(10)).map(d => ({ date: d, t: 20 }));
  const c2 = growth.current(s, fc); // 150 + 20×4 = 230 ≥ 220 → 第 4 天
  assert.strictEqual(c2.eta, D(4));
  // 农户说已经三叶了 → 校准后当前阶段为三叶期
  growth.calibrate(s, 'leaf3');
  const c3 = growth.current(store.seasons.get('sw'), fc);
  assert.strictEqual(c3.stage.key, 'leaf3');
  assert.ok(c3.calibrated);
  assert.strictEqual(growth.stageByName('wheat', '麦子都三片叶了'), 'leaf3');
  assert.strictEqual(growth.stageByName('corn', '已经完熟了'), 'mature');
});

// ---------- 预警 ----------
test('天气预警：连阴雨 / 霜冻 / 大风阈值', () => {
  const fc = [
    { date: D(1), t: 18, tmin: 12, tmax: 22, p: 0, wind: 3 },
    { date: D(2), t: 16, tmin: 12, tmax: 18, p: 14, wind: 4 },
    { date: D(3), t: 15, tmin: 11, tmax: 17, p: 18, wind: 5 },
    { date: D(4), t: 15, tmin: 10, tmax: 17, p: 10, wind: 11.5 },
    { date: D(5), t: 6, tmin: -1, tmax: 10, p: 0, wind: 3 }
  ];
  const a = advisor.alertsOf(fc);
  const rain = a.find(x => x.type === 'rain');
  assert.ok(rain && rain.start === D(2) && rain.end === D(4) && rain.sum === 42);
  assert.ok(a.find(x => x.type === 'frost'));
  assert.ok(a.find(x => x.type === 'wind'));
  assert.deepStrictEqual(advisor.alertsOf([{ date: D(1), t: 20, p: 3, wind: 2 }]), []);
});

// ---------- 规则任务 ----------
test('规则：出苗期生成查苗任务；同一规则只一条；记了巡田后消失（expired）', () => {
  const s = seedWheat(9, 15);
  setFc('pb', []);
  advisor.refreshSeason(s);
  const id = 'sw#wheat.checkSeedling';
  assert.ok(store.tasks.get(id), '生成查苗任务');
  assert.strictEqual(store.tasks.get(id).source, 'stage');
  advisor.refreshSeason(s);
  assert.strictEqual(store.tasks.all().filter(t => t.id === id).length, 1, '不重复');
  store.logs.save({ seasonId: 'sw', date: T, ops: ['巡田'], text: '查了一遍' });
  advisor.refreshSeason(s);
  assert.strictEqual(store.tasks.get(id).status, 'expired');
});

test('规则：完熟玉米 + 连阴雨 → 马上办抢收，并写出为什么', () => {
  reset();
  store.plots.save({ id: 'pa', name: '村东大块', area: 52, lat: 37.1, lng: 122.4 });
  store.seasons.save({ id: 'sc', plotId: 'pa', crop: 'corn', variety: '登海605', sowDate: D(-105) });
  fillWeather('pa', D(-105), T, 25); // 106 × 15 = 1590 ≥ 1480 → 完熟
  setFc('pa', [{ date: D(1), t: 20, p: 0 }, { date: D(2), t: 17, p: 14 }, { date: D(3), t: 15, p: 18 }, { date: D(4), t: 15, p: 10 }]);
  advisor.refreshSeason(store.seasons.get('sc'));
  const t = store.tasks.get('sc#corn.harvest');
  assert.ok(t);
  assert.strictEqual(advisor.bucketOf(t), 'now');
  assert.ok(t.title.indexOf('抢收') >= 0);
  assert.ok(t.why.some(w => w.indexOf('连阴雨') >= 0));
  assert.strictEqual(t.dueEnd, D(1));
  // 完熟玉米不推"清沟"（排除成熟期）
  assert.strictEqual(store.tasks.get('sc#any.drain'), undefined);
  const v = advisor.today();
  assert.ok(v.now.some(x => x.id === 'sc#corn.harvest'));
  assert.ok(v.alerts.length && v.alerts[0].plots[0].indexOf('村东大块') >= 0);
});

test('用户改过日期的任务：规则刷新不覆盖日期；记住"不用"后不再生成', () => {
  const s = seedWheat(9, 15);
  setFc('pb', []);
  advisor.refreshSeason(s);
  const id = 'sw#wheat.checkSeedling';
  store.tasks.setDue(id, D(5), D(5));
  advisor.refreshSeason(s);
  assert.strictEqual(store.tasks.get(id).dueStart, D(5));
  store.tasks.dismiss(id, '');
  store.memory.add({ text: '河边地不用查苗', plotId: 'pb', kind: 'suppress', ruleKey: 'wheat.checkSeedling' });
  store.tasks.remove(id);
  advisor.refreshSeason(s);
  assert.strictEqual(store.tasks.get(id), undefined);
});

test('巡田提醒：7 天没记就推一条（soft），今天页不计入待办数', () => {
  const s = seedWheat(20, 5);
  setFc('pb', []);
  store.logs.save({ seasonId: 'sw', date: D(-8), ops: ['施肥'], text: '' });
  advisor.refreshSeason(s);
  const t = store.tasks.get('sw#any.patrol');
  assert.ok(t);
  assert.strictEqual(advisor.bucketOf(t), 'soft');
  const v = advisor.today();
  assert.ok(v.soft.length >= 1);
});

// ---------- 语义解析 ----------

test('LLM 动作白名单：非法类型丢弃；无结构化载荷的记账也丢弃；结构化载荷出卡', () => {
  reset();
  store.plots.save({ id: 'pb', name: '河边地', area: 28, lat: 37.1, lng: 122.4 });
  store.seasons.save({ id: 'sw', plotId: 'pb', crop: 'wheat', variety: '济麦22', sowDate: D(-10) });
  const r = chat.fromLLM({ reply: '好', actions: [
    { type: 'db.drop' },
    { type: 'task.create', seasonId: 'sw', title: '浇水', date: D(3) },
    { type: 'cost.create', source: '花了一千二' },
    { type: 'cost.create', cost: { seasonIds: ['sw'], cat: 'agri', sub: '化肥', date: T, money: { mode: 'fixed', amount: 1200 }, note: '复合肥' } },
    { type: 'log.create', log: { seasonIds: ['sw'], date: T, ops: ['打药'], text: '打了遍蚜虫', materials: [{ type: '农药', name: '吡虫啉', rate: 3, unit: 'g/亩' }] } }
  ] }, {});
  assert.strictEqual(r.cards.filter(c => c.type === 'task.create').length, 1);
  assert.ok(!r.cards.some(c => c.type === 'db.drop'));
  assert.strictEqual(r.cards.filter(c => c.type === 'cost.create').length, 1);
  assert.strictEqual(r.cards.filter(c => c.type === 'cost.create')[0].payload.allocations[0].amount, 1200);
  const log = r.cards.find(c => c.type === 'log.create');
  assert.ok(log && log.payload.materials[0].name === '吡虫啉');
});

test('合规：推荐只含已登记；记录超量只提醒', () => {
  assert.ok(pesticide.recommend('wheat', '阔叶杂草').every(p => p.crops.indexOf('wheat') >= 0));
  assert.strictEqual(pesticide.check('wheat', '双氟磺草胺', 12, 'ml/亩').level, 'warn');
  assert.strictEqual(pesticide.check('wheat', '双氟磺草胺', 5, 'ml/亩').level, 'ok');
  assert.strictEqual(pesticide.check('wheat', '2,4-D 丁酯', 50, 'ml/亩').level, 'warn');
});
