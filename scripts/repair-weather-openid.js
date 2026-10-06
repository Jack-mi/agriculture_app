#!/usr/bin/env node
// 一次性修复（2026-10-06）：把云端 weather 集合里缺 _openid 的文档补上属主 openid。
// 背景：weatherBackfill/weatherDaily 加固前用 admin 权限写 weather，不带 _openid，
// 「仅创建者可读写」权限下客户端和 advisorAgent 都读不到这些记录。
// 链路：.env(AppID/AppSecret) → stable_token → tcb/databasequery + tcb/databaseupdate HTTP API。
// 用法：node scripts/repair-weather-openid.js [--dry]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ENV = 'cloud1-d5gzevmwkdff99eb5';
const DRY = process.argv.includes('--dry');

const env = {};
fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n').forEach(l => {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) env[l.slice(0, i)] = l.slice(i + 1).trim();
});

// ponytail: 本机 node 直连 api.weixin.qq.com 不通（代理只对 curl 生效），所以走 curl
function post(api, body, token) {
  const url = 'https://api.weixin.qq.com' + api + (token ? '?access_token=' + token : '');
  const out = execFileSync('curl', ['-s', '-X', 'POST', url, '-H', 'content-type: application/json', '-d', JSON.stringify(body)]);
  return Promise.resolve(JSON.parse(out.toString()));
}

(async () => {
  const t = await post('/cgi-bin/stable_token', { grant_type: 'client_credential', appid: env.AppID, secret: env.AppSecret });
  if (!t.access_token) throw new Error('stable_token 失败: ' + JSON.stringify(t));
  const AT = t.access_token;

  const q = (query) => post('/tcb/databasequery', { env: ENV, query }, AT).then(r => {
    if (r.errcode) throw new Error('query 失败: ' + JSON.stringify(r).slice(0, 300));
    return (r.data || []).map(s => JSON.parse(s));
  });

  // 地块属主映射
  const plots = await q('db.collection("plots").limit(1000).get()');
  const owner = {};
  plots.forEach(p => { owner[p._id] = p._openid; });
  console.log('[repair] plots:', plots.length);

  // 分页扫 weather，补缺 _openid 的
  let skip = 0, fixed = 0, scanned = 0, orphans = 0;
  for (;;) {
    const rows = await q('db.collection("weather").skip(' + skip + ').limit(100).get()');
    if (!rows.length) break;
    scanned += rows.length;
    for (const w of rows) {
      if (w._openid) continue;
      const oid = owner[w.plotId];
      if (!oid) {
        // 地块已删的孤儿天气：权限下谁也读不到，直接清掉
        orphans++;
        if (DRY) { console.log('[dry] 将删除孤儿:', w._id); continue; }
        const del = await post('/tcb/databasedelete', {
          env: ENV, query: 'db.collection("weather").doc("' + w._id + '").remove()'
        }, AT);
        if (del.errcode) console.log('[repair] 删除孤儿失败:', w._id, JSON.stringify(del).slice(0, 200));
        continue;
      }
      if (DRY) { console.log('[dry] 将修复:', w._id, '->', oid.slice(0, 8) + '…'); fixed++; continue; }
      const u = await post('/tcb/databaseupdate', {
        env: ENV,
        query: 'db.collection("weather").doc("' + w._id + '").update({data:{_openid:"' + oid + '"}})'
      }, AT);
      if (u.errcode) console.log('[repair] 更新失败:', w._id, JSON.stringify(u).slice(0, 200));
      else fixed++;
    }
    if (rows.length < 100) break;
    skip += rows.length;
  }
  console.log('[repair] 扫描 ' + scanned + ' 条，修复 ' + fixed + ' 条，清理孤儿 ' + orphans + ' 条' + (DRY ? '（dry-run 未写入）' : ''));
})().catch(e => { console.error('[repair] 失败:', e.message); process.exit(1); });
