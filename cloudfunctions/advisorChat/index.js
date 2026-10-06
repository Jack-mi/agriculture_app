// 农事参谋 · BYOK 大模型代理（OpenAI 兼容协议，默认 DeepSeek）
// 为什么需要它：微信云开发 AI 的混元/DeepSeek 额度需要在腾讯云控制台开通（要管理员扫码）。
// 这条路径让用户直接在小程序里配自己的 API Key，Key 只存云端 config 集合，不下发客户端。
//
// 安全模型（2026-10-06 加固）：
//  · 所有 action 必须先取 OPENID，匿名调用一律拒绝
//  · 配置按用户隔离：config 集合文档 id = advisor_ai_<openid>，谁也改不了别人的 Key/baseUrl
//  · 历史全局文档 advisor_ai 只读兜底（老数据），setKey/setModel 只写 per-user 文档
//  · baseUrl 强制 https://（防明文泄露 Key）
//  · chat 按用户限流（每天 RL_CAP 次，config 集合 rl_ 文档计数）
// action: chat（默认）/ setKey / setModel / status
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
const LEGACY_DOC = 'advisor_ai';
const RL_CAP = 100; // 每用户每天 chat 上限

function cfgDocId(openid) { return 'advisor_ai_' + openid; }

// 先查本人配置；没有则只读兜底历史全局配置（不允许写）
async function cfgDoc(openid) {
  const mine = await db.collection('config').doc(cfgDocId(openid)).get().then(r => r.data).catch(() => null);
  if (mine && mine.apiKey) return mine;
  return db.collection('config').doc(LEGACY_DOC).get().then(r => r.data).catch(() => null);
}

// ponytail: 计数非原子（读+写），并发下会少计几次；限流是防滥用不是计费，够用
async function rateLimit(openid, action, cap) {
  const day = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const id = 'rl_' + action + '_' + openid + '_' + day;
  try {
    const col = db.collection('config');
    const r = await col.doc(id).get().catch(() => null);
    const n = (r && r.data && r.data.n) || 0;
    if (n >= cap) return false;
    await col.doc(id).set({ data: { n: n + 1, updatedAt: Date.now() } });
    return true;
  } catch (e) { return true; } // 限流自身失败不阻塞业务
}

function validBase(u) {
  return /^https:\/\/[\w.-]+(:\d+)?(\/[\w./-]*)?$/.test(u);
}

function postJSON(url, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers) }, res => {
      let buf = '';
      res.on('data', c => { buf += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

exports.main = async (event) => {
  const action = event.action || 'chat';
  const openid = (cloud.getWXContext() || {}).OPENID || '';
  if (!openid) return { ok: false, reason: 'noauth' };

  if (action === 'setKey') {
    const apiKey = String(event.apiKey || '').trim();
    if (apiKey.length < 10) return { ok: false, reason: 'badkey' };
    const baseUrl = String(event.baseUrl || '').trim() || DEFAULT_BASE;
    if (!validBase(baseUrl)) return { ok: false, reason: 'badbase' };
    await db.collection('config').doc(cfgDocId(openid)).set({
      data: {
        apiKey,
        baseUrl,
        model: String(event.model || '').trim() || DEFAULT_MODEL,
        updatedAt: Date.now()
      }
    });
    return { ok: true };
  }

  if (action === 'status') {
    const c = await cfgDoc(openid);
    return { ok: true, configured: !!(c && c.apiKey), model: c ? c.model : '', baseUrl: c ? c.baseUrl : '' };
  }

  if (action === 'setModel') {
    const c = await cfgDoc(openid);
    if (!c || !c.apiKey) return { ok: false, reason: 'nokey' };
    const model = String(event.model || '').trim();
    if (!model) return { ok: false, reason: 'badargs' };
    const baseUrl = c.baseUrl || DEFAULT_BASE;
    if (!validBase(baseUrl)) return { ok: false, reason: 'badbase' };
    await db.collection('config').doc(cfgDocId(openid)).set({
      data: { apiKey: c.apiKey, baseUrl, model, updatedAt: Date.now() }
    });
    return { ok: true };
  }

  // chat：messages 原样转发（系统提示由客户端组装），返回纯文本
  if (!(await rateLimit(openid, 'chat', RL_CAP))) return { ok: false, reason: 'ratelimit' };
  const c = await cfgDoc(openid);
  if (!c || !c.apiKey) return { ok: false, reason: 'nokey' };
  if (!Array.isArray(event.messages) || !event.messages.length) return { ok: false, reason: 'badargs' };
  // 只保留最近 20 条、每条截断 4000 字，防超大 payload 烧额度
  const messages = event.messages.slice(-20).map(m => ({
    role: m && m.role, content: String((m && m.content) || '').slice(0, 4000)
  }));
  const base = (c.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
  let r;
  try {
    r = await postJSON(base + '/chat/completions',
      { authorization: 'Bearer ' + c.apiKey },
      JSON.stringify({ model: c.model || DEFAULT_MODEL, messages, stream: false }));
  } catch (e) {
    return { ok: false, reason: 'network', message: String(e.message || e) };
  }
  if (r.status !== 200) return { ok: false, reason: 'upstream', status: r.status, body: (r.body || '').slice(0, 300) };
  try {
    const j = JSON.parse(r.body);
    const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    return { ok: true, text: text || '' };
  } catch (e) {
    return { ok: false, reason: 'parse' };
  }
};
