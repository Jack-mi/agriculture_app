// 农事参谋 · BYOK 大模型代理（OpenAI 兼容协议，默认 DeepSeek）
// 为什么需要它：微信云开发 AI 的混元/DeepSeek 额度需要在腾讯云控制台开通（要管理员扫码）。
// 这条路径让用户直接在小程序里配自己的 API Key，Key 只存云端 config 集合（仅创建者可读写），不下发客户端。
// action: chat（默认）/ setKey / status
const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';

function cfgDoc() {
  return db.collection('config').doc('advisor_ai').get().then(r => r.data).catch(() => null);
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

  if (action === 'setKey') {
    const apiKey = String(event.apiKey || '').trim();
    if (apiKey.length < 10) return { ok: false, reason: 'badkey' };
    await db.collection('config').doc('advisor_ai').set({
      data: {
        apiKey,
        baseUrl: String(event.baseUrl || '').trim() || DEFAULT_BASE,
        model: String(event.model || '').trim() || DEFAULT_MODEL,
        updatedAt: Date.now()
      }
    });
    return { ok: true };
  }

  if (action === 'status') {
    const c = await cfgDoc();
    return { ok: true, configured: !!(c && c.apiKey), model: c ? c.model : '', baseUrl: c ? c.baseUrl : '' };
  }

  if (action === 'setModel') {
    const c = await cfgDoc();
    if (!c || !c.apiKey) return { ok: false, reason: 'nokey' };
    const model = String(event.model || '').trim();
    if (!model) return { ok: false, reason: 'badargs' };
    await db.collection('config').doc('advisor_ai').set({
      data: { apiKey: c.apiKey, baseUrl: c.baseUrl || DEFAULT_BASE, model, updatedAt: Date.now() }
    });
    return { ok: true };
  }

  // chat：messages 原样转发（系统提示由客户端组装），返回纯文本
  const c = await cfgDoc();
  if (!c || !c.apiKey) return { ok: false, reason: 'nokey' };
  const messages = event.messages;
  if (!Array.isArray(messages) || !messages.length) return { ok: false, reason: 'badargs' };
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
