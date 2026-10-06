// 跟参谋说：农户与参谋的日常沟通（LUI）
// 对象：任务（新建 / 调整 / 删除 / 完成）+ 地块（问建议→转任务、语音记事、语音记账、校准、查询）+ 记住 / 忘掉
// 进入时可带上下文：?taskId=…（带上这条任务）或 ?seasonId=…（带上这块地）
// 语音：微信同声传译插件（WechatSI）。未在 app.json 配置插件时自动降级为打字输入
const chat = require('../../utils/chat.js');
const store = require('../../utils/store.js');
const advisor = require('../../utils/advisor.js');
const C = require('../../utils/const.js');
const md = require('../../utils/md.js');
const chatlog = require('../../utils/chatlog.js');

let si = null;
try { si = requirePlugin('WechatSI'); } catch (e) { si = null; }

Page({
  data: { head: null, msgs: [], typing: false, text: '', recording: false, hasVoice: !!si, scrollTo: '' },

  onLoad(q) {
    this.ctx = { taskId: q.taskId ? decodeURIComponent(q.taskId) : '', seasonId: q.seasonId || '' };
    this.pending = null;
    this.cards = {};
    this.history = []; // 多轮对话上下文（只存文本轮，最多 12 条）
    this._sent = false;
    const rc = chat.resolveCtx(this.ctx);
    let head = null;
    if (rc.task) head = { kind: 'task', lv: advisor.bucketOf(rc.task), title: rc.task.title, sub: (rc.plot || {}).name || '' };
    else if (rc.season) head = { kind: 'season', title: (rc.plot || {}).name + ' · ' + C.cropOf(rc.season.crop).name + (rc.season.variety ? ' ' + rc.season.variety : ''), icon: C.cropOf(rc.season.crop).icon, cls: C.cropOf(rc.season.crop).cls };
    const local = chatlog.load(this.ctx);
    if (local && local.msgs && local.msgs.length) this.applyPack(local);
    else this.setHello(rc);
    this.setData({ head });
    chatlog.pull(this.ctx).then(remote => {
      if (this._sent || !remote || !remote.msgs || !remote.msgs.length) return;
      const localAt = (local && local.updatedAt) || 0;
      if (remote.updatedAt > localAt) this.applyPack(remote);
    });
    if (si) this.initVoice();
  },

  onUnload() {
    this.stopThinkTimer();
    if ((this.data.msgs || []).some(m => m.role === 'me')) this.persist();
  },

  setHello(rc) {
    rc = rc || chat.resolveCtx(this.ctx);
    const hello = rc.task ? '这条任务有啥要改的？直接说地里的实际情况。' : rc.season ? '想问这块地什么，或者记点什么，直接说。' : '想记点啥、问点啥，直接说。比如「后天提醒我去河边地打药」。';
    this.history = [];
    this.cards = {};
    this.setData({ msgs: [{ id: 'm0', role: 'ai', text: hello, nodes: md.mdNodes(hello) }] });
  },
  applyPack(pack) {
    this.history = pack.history || [];
    this.cards = pack.cards || {};
    const msgs = (pack.msgs || []).map(m => Object.assign({}, m, {
      nodes: m.role === 'ai' && m.text ? md.mdNodes(m.text) : null,
      reasonOpen: false
    }));
    this.setData({ msgs, scrollTo: msgs.length ? msgs[msgs.length - 1].id : '' });
  },
  persist() {
    chatlog.save(this.ctx, { msgs: this.data.msgs, history: this.history, cards: this.cards });
  },

  // ---------- 语音 ----------
  initVoice() {
    this.rec = si.getRecordRecognitionManager();
    this.rec.onStop = r => { this.setData({ recording: false }); if (r && r.result) this.send(r.result.replace(/[。]$/, '')); };
    this.rec.onError = () => { this.setData({ recording: false }); wx.showToast({ title: '没听清，再说一次', icon: 'none' }); };
  },
  holdStart() {
    if (!this.rec) return this.setData({ typing: true });
    this.setData({ recording: true });
    this.rec.start({ lang: 'zh_CN', duration: 30000 });
  },
  holdEnd() { if (this.rec && this.data.recording) this.rec.stop(); },
  toggleType() { this.setData({ typing: !this.data.typing }); },
  onInput(e) { this.setData({ text: e.detail.value }); },
  sendText() { const t = this.data.text.trim(); if (t) { this.setData({ text: '' }); this.send(t); } },
  photo() {
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera', 'album'], success: r => {
      const path = r.tempFiles[0].tempFilePath;
      this._sent = true;
      this.push({ role: 'me', img: path });
      const thinking = this.push({ role: 'ai', thinking: true });
      this.startThinkTimer(thinking);
      this.persist();
      let b64 = '';
      try { b64 = wx.getFileSystemManager().readFileSync(path, 'base64'); } catch (e) {}
      if (!b64) return this.reply({ reply: '照片读不出来，再拍一次？', cards: [], chips: [] }, thinking);
      chat.askImage('', b64, this.ctx).then(res => this.reply(res, thinking))
        .catch(() => this.reply({ reply: '识图出了点问题，再发一次？', cards: [], chips: [] }, thinking));
    } });
  },

  // ---------- 对话 ----------
  push(m) {
    m.id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const msgs = this.data.msgs.concat([m]);
    this.setData({ msgs, scrollTo: m.id });
    return m.id;
  },
  // 「思考中…」气泡：点一下展开/收起；展开时能看到已经等了几秒
  toggleThink(e) {
    const id = e.currentTarget.dataset.id;
    const msgs = this.data.msgs.map(m => m.id === id ? Object.assign({}, m, { thinkOpen: !m.thinkOpen }) : m);
    this.setData({ msgs });
  },
  startThinkTimer(id) {
    this.stopThinkTimer();
    const t0 = Date.now();
    this._thinkTimer = setInterval(() => {
      const msgs = this.data.msgs.map(m => (m.id === id && m.thinking) ? Object.assign({}, m, { thinkSec: Math.floor((Date.now() - t0) / 1000) }) : m);
      this.setData({ msgs });
    }, 1000);
  },
  stopThinkTimer() { if (this._thinkTimer) { clearInterval(this._thinkTimer); this._thinkTimer = null; } },
  send(text) {
    this._sent = true;
    this.push({ role: 'me', text });
    const thinking = this.push({ role: 'ai', thinking: true });
    this.startThinkTimer(thinking);
    const prior = this.history.slice();
    this.history.push({ role: 'user', content: text });
    if (this.history.length > 12) this.history = this.history.slice(-12);
    this.persist();
    chat.ask(text, this.ctx, this.pending, prior).then(r => {
      if (r.reply) this.history.push({ role: 'assistant', content: r.reply });
      if (this.history.length > 12) this.history = this.history.slice(-12);
      this.reply(r, thinking);
    }).catch(() => this.reply({ reply: '出了点问题，再说一次？', cards: [], chips: [] }, thinking));
  },
  reply(r, replaceId) {
    this.stopThinkTimer();
    const msgs = this.data.msgs.filter(m => m.id !== replaceId);
    this.setData({ msgs });
    // 补槽位：改写已有卡片
    if (r.fill) {
      const card = this.cards[r.fill.cardId];
      if (card) { const nc = chat.fillCard(card, r.fill); this.cards[nc.id] = nc; this.replaceCard(nc); }
    }
    const cards = (r.cards || []).map(c => { this.cards[c.id] = c; return this.viewCard(c); });
    const text = r.reply || '';
    this.push({ role: 'ai', text, nodes: md.mdNodes(text), reasoning: r.reasoning || '', reasonOpen: false, list: r.list || null, cards });
    if (r.ask) this.push({ role: 'ai', text: r.ask, nodes: md.mdNodes(r.ask) });
    this.pending = r.pending || (r.fill ? null : this.pending && r.cards && r.cards.length ? null : this.pending);
    if (r.pending) this.pending = r.pending;
    this.persist();
  },
  toggleReason(e) {
    const id = e.currentTarget.dataset.id;
    const msgs = this.data.msgs.map(m => (m.id === id ? Object.assign({}, m, { reasonOpen: !m.reasonOpen }) : m));
    this.setData({ msgs });
  },
  // 卡片视图：rows 里 {old, now} 显示为「改前 → 改后」
  viewCard(c) {
    return { id: c.id, tag: c.tag, tagCls: c.tagCls, title: c.title, ok: c.ok, warn: c.warn || '', state: 'open',
      rows: (c.rows || []).map(r => (typeof r === 'string' ? { text: r } : { old: r.old, now: r.now })) };
  },
  replaceCard(nc) {
    const v = this.viewCard(nc);
    const msgs = this.data.msgs.map(m => (m.cards ? Object.assign({}, m, { cards: m.cards.map(x => (x.id === nc.id ? v : x)) }) : m));
    this.setData({ msgs });
  },
  cardOpen(id) {
    let open = false;
    (this.data.msgs || []).forEach(m => (m.cards || []).forEach(c => { if (c.id === id && c.state === 'open') open = true; }));
    return open;
  },
  noteCard(card, verb) {
    const line = (verb + '：' + (card.tag || '') + ' ' + (card.title || card.type || '')).slice(0, 80);
    this.history.push({ role: 'assistant', content: line });
    if (this.history.length > 12) this.history = this.history.slice(-12);
  },
  setCardState(id, state) {
    const msgs = this.data.msgs.map(m => (m.cards ? Object.assign({}, m, { cards: m.cards.map(x => (x.id === id ? Object.assign({}, x, { state }) : x)) }) : m));
    this.setData({ msgs });
    this.persist();
  },
  confirm(e) {
    const id = e.currentTarget.dataset.id;
    const card = this.cards[id];
    if (!card || !this.cardOpen(id) || this._busy === id) return;
    if (card.type === 'plot.locate') {
      this._busy = id;
      wx.chooseLocation({
        success: (loc) => {
          this._busy = '';
          const plot = store.plots.get(card.payload.plotId);
          if (!plot) return wx.showToast({ title: '找不到这块地', icon: 'none' });
          store.plots.save({
            id: plot.id, name: plot.name, area: plot.area,
            lat: Math.round(loc.latitude * 1000) / 1000,
            lng: Math.round(loc.longitude * 1000) / 1000,
            address: loc.name || loc.address || plot.address || '已定位'
          });
          this.noteCard(card, '农户已选位置');
          this.setCardState(id, 'done');
        },
        fail: () => { this._busy = ''; wx.showToast({ title: '没选成位置', icon: 'none' }); }
      });
      return;
    }
    this._busy = id;
    const r = chat.execute(card);
    this._busy = '';
    if (!r.ok) return wx.showToast({ title: '没改成，再试一次', icon: 'none' });
    this.noteCard(card, '农户已确认');
    this.setCardState(id, 'done');
    wx.vibrateShort && wx.vibrateShort({ type: 'light' });
    // 新建 / 调整任务后，刷新一下相关季
    const sid = (card.payload && (card.payload.seasonId || (card.payload.seasonIds || [])[0])) || (store.tasks.get((card.payload || {}).taskId || '') || {}).seasonId;
    if (sid && card.type !== 'log.create' && card.type !== 'plot.create') advisor.onSeasonChanged(sid);
  },
  reject(e) {
    const id = e.currentTarget.dataset.id;
    const card = this.cards[id];
    if (!this.cardOpen(id)) return;
    if (card) this.noteCard(card, '农户没同意');
    this.setCardState(id, 'no');
    this.push({ role: 'ai', text: '哪里不对？再说一下。', nodes: md.mdNodes('哪里不对？再说一下。') });
    this.persist();
  },
  // 改一改：打开已有的记事页 / 记一笔页细改
  edit(e) {
    const card = this.cards[e.currentTarget.dataset.id];
    if (!card) return;
    const p = card.payload;
    if (card.type === 'log.create') {
      const m = (p.materials || [])[0] || {};
      wx.navigateTo({ url: '/pages/log-edit/log-edit?seasonId=' + p.seasonIds[0] + '&date=' + p.date + '&ops=' + encodeURIComponent((p.ops || []).join(',')) +
        '&mat=' + encodeURIComponent(m.type || '') + '&matName=' + encodeURIComponent(m.name || '') + '&matUnit=' + encodeURIComponent(m.unit || '') +
        '&text=' + encodeURIComponent(p.text || '') + (p.taskId ? '&taskId=' + encodeURIComponent(p.taskId) : '') });
    } else if (card.type === 'cost.create') {
      wx.navigateTo({ url: '/pages/cost-edit/cost-edit?seasonId=' + p.allocations[0].seasonId + '&date=' + p.date + '&cat=' + p.cat + '&sub=' + encodeURIComponent(p.sub) + '&note=' + encodeURIComponent(p.note || '') });
    }
    this.setCardState(card.id, 'edit');
  },
  goTaskHead() { if (this.ctx.taskId) wx.navigateBack(); }
});
