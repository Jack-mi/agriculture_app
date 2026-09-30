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
const nlu = require('../utils/nlu.js');
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
test('nlu：中文数字 / 日期 / 金额 / 农资 / 机械', () => {
  assert.strictEqual(nlu.cn2num('十五'), 15);
  assert.strictEqual(nlu.cn2num('一千二'), 1200);
  assert.strictEqual(nlu.cn2num('两万五'), 25000);
  assert.strictEqual(nlu.cn2num('三百'), 300);
  assert.strictEqual(nlu.parseDate('后天提醒我'), D(2));
  assert.strictEqual(nlu.parseDate('明天'), D(1));
  const m = nlu.parseMoney('老张家无人机，一亩十五，打的吡虫啉');
  assert.strictEqual(m.mode, 'perMu'); assert.strictEqual(m.unitPrice, 15);
  const m2 = nlu.parseMoney('一共花了一千二');
  assert.strictEqual(m2.mode, 'fixed'); assert.strictEqual(m2.amount, 1200);
  const m3 = nlu.parseMoney('雇了三个人，一人两百');
  assert.strictEqual(m3.mode, 'perDay'); assert.strictEqual(m3.people, 3); assert.strictEqual(m3.unitPrice, 200);
  assert.deepStrictEqual(nlu.parseMaterials('打的吡虫啉，一亩20克', ['吡虫啉']), [{ type: '农药', name: '吡虫啉', rate: 20, unit: 'g/亩' }]);
  assert.strictEqual(nlu.parseMachine('老张家无人机飞的'), '老张家无人机');
  assert.ok(nlu.matchOps('今天飞防了').indexOf('打药') >= 0);
  assert.strictEqual(nlu.parseShift('往后推三天'), 3);
});

// ---------- 对话 ----------
function seedTwo() {
  reset();
  store.plots.save({ id: 'pa', name: '村东大块', area: 52, lat: 37.1, lng: 122.4 });
  store.plots.save({ id: 'pb', name: '河边地', area: 28, lat: 37.1, lng: 122.4 });
  store.seasons.save({ id: 'sc', plotId: 'pa', crop: 'corn', sowDate: D(-60) });
  store.seasons.save({ id: 'sw', plotId: 'pb', crop: 'wheat', sowDate: D(-9) });
  fillWeather('pa', D(-60), T, 22); fillWeather('pb', D(-9), T, 15);
  setFc('pa', []); setFc('pb', [{ date: D(2), t: 15, p: 0 }, { date: D(3), t: 14, p: 4 }]);
}

test('对话 · 新建任务：「后天提醒我去河边地打蚜虫」→ 新任务卡，确认后进待办', () => {
  seedTwo();
  const r = chat.understand('后天提醒我去河边地打蚜虫', {});
  assert.strictEqual(r.cards.length, 1);
  const c = r.cards[0];
  assert.strictEqual(c.type, 'task.create');
  assert.strictEqual(c.payload.seasonId, 'sw');
  assert.strictEqual(c.payload.dueStart, D(2));
  assert.ok(c.payload.title.indexOf('蚜虫') >= 0);
  assert.ok(c.warn.indexOf('小雨') >= 0 || c.warn.indexOf('雨') >= 0, '次日有雨给提示');
  const res = chat.execute(c);
  const t = store.tasks.get(res.taskId);
  assert.strictEqual(t.source, 'user');
  assert.strictEqual(t.status, 'open');
});

test('对话 · 调整任务：改日期 → 改任务卡（改前→改后），追问后可记住', () => {
  seedTwo();
  const t = store.tasks.save({ seasonId: 'sc', plotId: 'pa', key: 'corn.harvest', source: 'stage', title: '雨前抢收玉米', dueStart: T, dueEnd: D(1), ops: ['收获'] });
  const r = chat.understand('收割机明天来不了，最早后天上午。东头那片还没熟透', { taskId: t.id });
  const c = r.cards.find(x => x.type === 'task.update');
  assert.ok(c);
  assert.strictEqual(c.payload.dueStart, D(2));
  assert.ok(r.pending && r.pending.kind === 'rememberAfterUpdate');
  chat.execute(c);
  assert.strictEqual(store.tasks.get(t.id).dueStart, D(2));
  assert.ok(store.tasks.get(t.id).userDue);
  const f = chat.followUp('记住', r.pending, { taskId: t.id });
  assert.strictEqual(f.cards[0].type, 'memory.add');
  chat.execute(f.cards[0]);
  assert.strictEqual(store.memory.all().length, 1);
});

test('对话 · 一句话两件事：校准生育期 + 补记完成任务', () => {
  seedTwo();
  const t = store.tasks.save({ id: 'sw#wheat.checkSeedling', seasonId: 'sw', plotId: 'pb', key: 'wheat.checkSeedling', source: 'stage', title: '查苗，缺苗断垄及时补种', dueStart: T, dueEnd: D(6), ops: ['巡田'] });
  const r = chat.understand('麦子都三片叶了，查苗昨天也弄完了，断垄补了两垄', { taskId: t.id });
  const types = r.cards.map(c => c.type);
  assert.ok(types.indexOf('stage.calibrate') >= 0);
  assert.ok(types.indexOf('log.create') >= 0);
  const log = r.cards.find(c => c.type === 'log.create');
  assert.strictEqual(log.payload.date, D(-1));
  assert.strictEqual(log.payload.taskId, t.id);
  r.cards.forEach(c => chat.execute(c));
  assert.strictEqual(store.tasks.get(t.id).status, 'done');
  assert.strictEqual(growth.current(store.seasons.get('sw')).stage.key, 'leaf3');
});

test('对话 · 删除任务：「这件不用做了」→ 删除卡；说「以后都不用」会记住并抑制该规则', () => {
  seedTwo();
  const t = store.tasks.save({ id: 'sw#wheat.herbicide', seasonId: 'sw', plotId: 'pb', key: 'wheat.herbicide', source: 'stage', title: '冬前化学除草', dueStart: T, dueEnd: D(10), ops: ['除草'] });
  const r = chat.understand('这块地不用打除草剂，以后都不用', { taskId: t.id });
  const c = r.cards[0];
  assert.strictEqual(c.type, 'task.dismiss');
  assert.ok(c.payload.remember);
  chat.execute(c);
  assert.strictEqual(store.tasks.get(t.id).status, 'dismissed');
  assert.ok(store.memory.suppressed('wheat.herbicide', 'pb'));
});

test('对话 · 地块语音记事 + 记账：两块地飞防，按亩计 + 按亩均摊；缺用量追问后补上', () => {
  seedTwo();
  const r = chat.understand('今天两块地都飞防了，老张家无人机，一亩十五，打的吡虫啉', {});
  const log = r.cards.find(c => c.type === 'log.create');
  const cost = r.cards.find(c => c.type === 'cost.create');
  assert.ok(log && cost);
  assert.deepStrictEqual(log.payload.seasonIds.sort(), ['sc', 'sw']);
  assert.strictEqual(log.payload.machine, '老张家无人机');
  assert.strictEqual(cost.payload.calc.unitPrice, 15);
  assert.strictEqual(cost.payload.calc.mu, 80);
  assert.deepStrictEqual(cost.payload.allocations.map(a => a.amount).sort((a, b) => a - b), [420, 780]);
  assert.strictEqual(cost.payload.sub, '飞防');
  assert.ok(r.pending && r.pending.kind === 'fillRate');
  const f = chat.followUp('一亩 20 克', r.pending, {});
  const filled = chat.fillCard(log, f.fill);
  assert.strictEqual(filled.payload.materials[0].rate, 20);
  chat.execute(filled); chat.execute(cost);
  assert.strictEqual(store.logs.bySeason('sc').length, 1);
  assert.strictEqual(store.logs.bySeason('sw').length, 1);
  assert.strictEqual(store.costs.bySeason('sc')[0].amount, 1200);
});

test('对话 · 问建议 → 建议卡（不自动进待办），加成任务后来源为参谋建议', () => {
  seedTwo();
  const r = chat.understand('这块麦子入冬前还要干点啥？', { seasonId: 'sw' });
  assert.ok(r.cards.length >= 1);
  assert.ok(r.cards.every(c => c.type === 'task.create' && c.payload.source === 'advice'));
  const before = store.tasks.open().length;
  assert.strictEqual(before, 0, '建议不自动进待办');
  const res = chat.execute(r.cards[0]);
  assert.strictEqual(store.tasks.get(res.taskId).source, 'advice');
});

test('对话 · 查询：这季化肥花了多少 / 上回打药哪天；记住的列表与忘掉', () => {
  seedTwo();
  store.costs.save({ seasonId: 'sw', date: D(-3), cat: 'agri', sub: '化肥', allocations: [{ seasonId: 'sw', amount: 3080 }] });
  store.logs.save({ seasonId: 'sw', date: D(-5), ops: ['打药'], text: '打了一遍' });
  assert.ok(chat.understand('河边地这季化肥花了多少', {}).reply.indexOf('3,080') >= 0);
  assert.ok(chat.understand('上回打药是哪天', { seasonId: 'sw' }).reply.indexOf(advisor.md(D(-5))) >= 0);
  store.memory.add({ text: '不用 2,4-D 丁酯（周边有花生）', plotId: 'pb' });
  const l = chat.understand('你都记住我啥了？', {});
  assert.strictEqual(l.list.length, 1);
  const f = chat.understand('2,4-D 那条忘了吧', {});
  assert.strictEqual(f.cards[0].type, 'memory.remove');
  chat.execute(f.cards[0]);
  assert.strictEqual(store.memory.all().length, 0);
});

test('对话 · LLM 动作白名单：非法类型丢弃，记账必须经本地复核', () => {
  seedTwo();
  const r = chat.fromLLM({ reply: '好', actions: [{ type: 'db.drop' }, { type: 'task.create', seasonId: 'sw', title: '浇水', date: D(3) }, { type: 'cost.create', source: '花了一千二' }] }, {});
  assert.strictEqual(r.cards.filter(c => c.type === 'task.create').length, 1);
  assert.ok(!r.cards.some(c => c.type === 'db.drop'));
});

test('合规：推荐只含已登记；记录超量只提醒', () => {
  assert.ok(pesticide.recommend('wheat', '阔叶杂草').every(p => p.crops.indexOf('wheat') >= 0));
  assert.strictEqual(pesticide.check('wheat', '双氟磺草胺', 12, 'ml/亩').level, 'warn');
  assert.strictEqual(pesticide.check('wheat', '双氟磺草胺', 5, 'ml/亩').level, 'ok');
  assert.strictEqual(pesticide.check('wheat', '2,4-D 丁酯', 50, 'ml/亩').level, 'warn');
});
