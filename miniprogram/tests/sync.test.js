// 同步引擎：死信隔离 / 硬删除对账 / 水位线重叠
const test = require('node:test');
const assert = require('node:assert');

const mem = {};
let cloudData = {};   // colName -> [records]
let failWrites = false;

global.wx = {
  getStorageSync: k => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  cloud: {
    init() {},
    callFunction: () => Promise.resolve({ result: { openid: 'o1' } }),
    uploadFile: ({ cloudPath, filePath }) => Promise.resolve({ fileID: 'cloud://test/' + cloudPath }),
    database: () => ({
      command: { gt: v => ({ $gt: v }) },
      collection(name) {
        return {
          doc(id) {
            return {
              set: () => failWrites ? Promise.reject(new Error('perm denied')) : Promise.resolve({}),
              remove: () => Promise.resolve({})
            };
          },
          where() { return { orderBy() { return { skip() { return { limit() { return { get: () => Promise.resolve({ data: cloudData[name] || [] }) }; } }; } }; } }; },
          limit() { return { get: () => Promise.resolve({ data: cloudData[name] || [] }) }; }
        };
      }
    })
  }
};
global.getApp = () => null;

const store = require('../utils/store.js');
const sync = require('../utils/sync.js');

function reset() {
  Object.keys(mem).forEach(k => delete mem[k]);
  store.replaceAll({});
  cloudData = {};
  failWrites = false;
  sync.init('test-env');
}

test('永久性写入失败：超过上限进死信，不再堵后面的条目', async () => {
  reset();
  failWrites = true;
  store.plots.save({ id: 'p1', name: '东地', area: 10 });
  assert.strictEqual(store.outbox().length, 1);
  for (let i = 0; i < 6; i++) await sync.flush();
  assert.strictEqual(store.outbox().length, 0, '死信后 outbox 应清空');
  assert.strictEqual(sync.status().dead, 1);
  // 修复后重试能重新入队
  failWrites = false;
  assert.strictEqual(sync.retryDead(), 1);
  assert.strictEqual(sync.status().dead, 0);
  assert.strictEqual(store.outbox().length, 1);
  await sync.flush();
  assert.strictEqual(store.outbox().length, 0);
});

test('硬删除对账：云端没了的本地幽灵被清掉，待同步的保留', async () => {
  reset();
  store.plots.save({ id: 'p1', name: '已同步后被别台设备删', area: 10 });
  mem[store.OUTBOX_KEY] = []; // 假装 p1 已同步成功
  store.plots.save({ id: 'p2', name: '本地新建还没传', area: 5 });
  assert.strictEqual(store.db().plots.length, 2);
  await sync.pull(); // 云端 plots 为空
  const ids = store.db().plots.map(p => p.id);
  assert.deepStrictEqual(ids, ['p2'], 'p1 幽灵被清，p2 有待同步条目被保留');
});

test('对账每天只跑一次', async () => {
  reset();
  store.plots.save({ id: 'p1', name: 'x', area: 1 });
  mem[store.OUTBOX_KEY] = [];
  await sync.pull();
  assert.strictEqual(store.db().plots.length, 0);
  // 同一天再新建一条已同步态记录，当天不再对账，不会误删
  store.plots.save({ id: 'p3', name: 'y', area: 1 });
  mem[store.OUTBOX_KEY] = [];
  await sync.pull();
  assert.strictEqual(store.db().plots.length, 1);
});

test('账号资料：昵称落缓存，chooseAvatar 临时路径先传云存储再存 fileID', async () => {
  reset();
  let p = await sync.updateProfile({ nickName: '  老王的地  ' });
  assert.strictEqual(p.nickName, '老王的地');
  assert.strictEqual(sync.profile().nickName, '老王的地');
  p = await sync.updateProfile({ avatarUrl: 'wxfile://tmp_avatar.png' });
  assert.strictEqual(p.avatarUrl.indexOf('cloud://'), 0, '临时路径必须转成云存储 fileID');
  assert.strictEqual(sync.profile().avatarUrl, p.avatarUrl);
  // 已是 fileID 的不重复上传
  const before = p.avatarUrl;
  p = await sync.updateProfile({ avatarUrl: before });
  assert.strictEqual(p.avatarUrl, before);
});
