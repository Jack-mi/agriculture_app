const store = require('../../utils/store.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');
const advisor = require('../../utils/advisor.js');
const pesticide = require('../../utils/pesticide.js');

Page({
  data: {
    id: '', seasonId: '', opsAll: [], ops: {}, text: '', date: '', today: '',
    dateStart: '', dateEnd: '',
    growth: '', pest: '', machine: '', areaMu: '',
    materials: [], materialTypes: C.MATERIAL_TYPES, materialUnits: C.MATERIAL_UNITS,
    moisture: '', moistQuick: C.MOISTURE, isEdit: false,
    w: null, seasonLabel: '', linkedCost: 0, plotId: '',
    show: {}, src: {}, ph: {}, hasOps: false,
    taskId: '', fromTask: '', matWarn: {}, crop: ''
  },

  onLoad(q) {
    let s;
    if (q.id) {
      const l = store.logs.get(q.id);
      if (!l) return wx.navigateBack();
      s = store.seasons.get(l.seasonId);
      const ops = {}; (l.ops || []).forEach(o => { ops[o] = true; });
      this.setData({
        id: l.id, seasonId: l.seasonId, ops, text: l.text || '', date: l.date,
        growth: l.growth || '', pest: l.pest || '', machine: l.machine || '',
        areaMu: l.areaMu ? String(l.areaMu) : '',
        materials: store.logs.materialsOf(l).map(m => this.matRow(m)),
        moisture: l.moisture || '', isEdit: true,
        linkedCost: store.db().costs.filter(c => c.logId === l.id).reduce((a, c) => a + store.costs.amountFor(c, l.seasonId), 0)
      });
      // 旧记录：没有被所选类型覆盖、但已有内容的项，编辑时仍显示，避免看不到历史数据
      this._legacy = { mat: store.logs.materialsOf(l).length > 0, machine: !!l.machine, area: !!l.areaMu, growth: !!l.growth, pest: !!l.pest, moisture: !!l.moisture };
      wx.setNavigationBarTitle({ title: '修改记事' });
    } else {
      s = store.seasons.get(q.seasonId);
      this.setData({ seasonId: q.seasonId, date: q.date || U.today() });
      // 来自任务 / 对话的预填：活的类型、农资、面积、文字
      const pre = {};
      if (q.ops) { const ops = {}; decodeURIComponent(q.ops).split(',').filter(Boolean).forEach(o => { ops[o] = true; }); pre.ops = ops; }
      if (q.mat) pre.materials = [this.matRow({ type: decodeURIComponent(q.mat), name: q.matName ? decodeURIComponent(q.matName) : '', unit: q.matUnit ? decodeURIComponent(q.matUnit) : (C.MATERIAL_UNIT_DEFAULT[decodeURIComponent(q.mat)] || '') })];
      if (q.mu) pre.areaMu = String(q.mu);
      if (q.text) pre.text = decodeURIComponent(q.text);
      if (q.taskId) {
        const tk = store.tasks.get(decodeURIComponent(q.taskId));
        if (tk) { pre.taskId = tk.id; pre.fromTask = tk.title; }
      }
      this.setData(pre);
    }
    // 日期限制在当前种植季起止范围内（已收获季节可补记到收获日）
    if (s) {
      const end = store.seasons.endDate(s);
      let date = this.data.date;
      if (date < s.sowDate) date = s.sowDate;
      if (date > end) date = end;
      this.setData({ dateStart: s.sowDate, dateEnd: end, date });
    }
    const plot = s && store.plots.get(s.plotId);
    this.setData({ today: U.today(), seasonLabel: plot ? plot.name + ' · ' + C.cropOf(s.crop).name : '', plotId: s ? s.plotId : '', crop: s ? s.crop : '' });
    this.checkMats();
    this.showWx();
    this.syncFields();
  },

  matRow(m) {
    m = m || {};
    const ti = C.MATERIAL_TYPES.indexOf(m.type);
    const ui = C.MATERIAL_UNITS.indexOf(m.unit);
    return {
      type: ti >= 0 ? m.type : '化肥', typeIndex: ti >= 0 ? ti : 2,
      name: m.name || '', rate: m.rate !== undefined && m.rate !== '' ? String(m.rate) : '',
      unit: ui >= 0 ? m.unit : '斤/亩', unitIndex: ui >= 0 ? ui : 0
    };
  },

  onShow() { this.loadTags(); this.syncFields(); },

  // 上下对应：只显示"已选的活"需要的填写项；编辑旧记录时有内容的项也保留显示
  syncFields() {
    const d = this.data;
    const sel = d.opsAll.map(t => t.name).filter(o => d.ops[o]);
    const show = {}, src = {};
    sel.forEach(o => {
      const tag = store.tags.logTag(o);
      ((tag && tag.fields) || []).forEach(f => { show[f] = true; (src[f] = src[f] || []).push(o); });
    });
    const keep = this._legacy || {};
    Object.keys(keep).forEach(f => { if (keep[f] && !show[f]) { show[f] = true; src[f] = src[f] || []; } });
    const ph = {};
    Object.keys(C.LOG_FIELD_PH).forEach(f => {
      const m = C.LOG_FIELD_PH[f]; const hit = (src[f] || []).find(o => m[o]);
      ph[f] = hit ? m[hit] : m._;
    });
    const srcText = {}; Object.keys(src).forEach(f => { srcText[f] = src[f].join(' · '); });
    this.setData({ show, src: srcText, ph, hasOps: sel.length > 0 });
  },

  // 记事类型 = 用户自定义；旧记录里已删除的类型临时补回
  loadTags() {
    const list = store.tags.log().map(t => ({ name: t.name, color: t.color }));
    Object.keys(this.data.ops).forEach(o => {
      if (this.data.ops[o] && !list.some(t => t.name === o)) list.push({ name: o, color: '#9A8F7A' });
    });
    this.setData({ opsAll: list });
  },

  showWx() {
    const w = this.data.plotId && store.weather.get(this.data.plotId, this.data.date);
    this.setData({ w: w || null });
  },

  toggleOp(e) {
    const o = e.currentTarget.dataset.o;
    const ops = Object.assign({}, this.data.ops);
    ops[o] = !ops[o];
    const patch = { ops };
    // 首次选中带农资的活（施肥/打药/播种…）：自动加一行对应品类，省一步
    const tag = store.tags.logTag(o);
    if (ops[o] && tag && (tag.fields || []).indexOf('mat') >= 0 && tag.matType && !this.data.materials.some(m => m.type === tag.matType)) {
      patch.materials = this.data.materials.concat([this.matRow({ type: tag.matType, unit: C.MATERIAL_UNIT_DEFAULT[tag.matType] })]);
    }
    this.setData(patch);
    this.syncFields();
  },
  addOp() {
    wx.showModal({
      title: '新增记事类型', editable: true, placeholderText: '如：镇压、中耕、测产',
      success: r => {
        if (!r.confirm) return;
        const name = (r.content || '').trim();
        if (!name) return U.toast('请输入类型名称');
        if (!store.tags.addLog({ name }) && !store.tags.logTag(name)) return U.toast('添加失败');
        const ops = Object.assign({}, this.data.ops); ops[name] = true;
        this.setData({ ops });
        this.loadTags();
        this.syncFields();
        U.toast('可在「管理类型」里给它设置要填的项');
      }
    });
  },
  manageTags() { wx.navigateTo({ url: '/pages/tags/tags?tab=log' }); },
  onText(e) { this.setData({ text: e.detail.value }); },
  onDate(e) { this.setData({ date: e.detail.value }); this.showWx(); },
  onGrowth(e) { this.setData({ growth: e.detail.value }); },
  onPest(e) { this.setData({ pest: e.detail.value }); },
  onMachine(e) { this.setData({ machine: e.detail.value }); },
  onAreaMu(e) { this.setData({ areaMu: e.detail.value }); },
  onMoist(e) { this.setData({ moisture: e.detail.value }); },
  pickMoist(e) { this.setData({ moisture: e.currentTarget.dataset.m }); },

  addMat() { this.setData({ materials: this.data.materials.concat([this.matRow()]) }); },
  delMat(e) {
    const list = this.data.materials.slice();
    list.splice(e.currentTarget.dataset.i, 1);
    this.setData({ materials: list });
    this.syncFields();
  },
  onMatType(e) {
    const i = e.currentTarget.dataset.i, ti = +e.detail.value;
    const unit = C.MATERIAL_UNIT_DEFAULT[C.MATERIAL_TYPES[ti]] || this.data.materials[i].unit;
    this.setData({ ['materials[' + i + '].typeIndex']: ti, ['materials[' + i + '].type']: C.MATERIAL_TYPES[ti], ['materials[' + i + '].unit']: unit, ['materials[' + i + '].unitIndex']: Math.max(0, C.MATERIAL_UNITS.indexOf(unit)) });
  },
  onMatUnit(e) {
    const i = e.currentTarget.dataset.i, ui = +e.detail.value;
    this.setData({ ['materials[' + i + '].unitIndex']: ui, ['materials[' + i + '].unit']: C.MATERIAL_UNITS[ui] });
    this.checkMats();
  },
  onMatName(e) { this.setData({ ['materials[' + e.currentTarget.dataset.i + '].name']: e.detail.value }); this.checkMats(); },
  onMatRate(e) { this.setData({ ['materials[' + e.currentTarget.dataset.i + '].rate']: e.detail.value }); this.checkMats(); },
  // 农药合规：记录时只提醒、不拦保存
  checkMats() {
    const w = {};
    (this.data.materials || []).forEach((m, i) => {
      if (m.type !== '农药' || !m.name) return;
      const r = pesticide.check(this.data.crop, m.name, m.rate, m.unit);
      if (r.level !== 'unknown') w[i] = r;
    });
    this.setData({ matWarn: w });
  },

  collect() {
    const d = this.data;
    const ops = d.opsAll.map(t => t.name).filter(o => d.ops[o]);
    const sh = d.show || {};
    const materials = (sh.mat ? d.materials : [])
      .map(m => ({ type: m.type, name: (m.name || '').trim(), rate: m.rate !== '' ? parseFloat(m.rate) : '', unit: m.unit }))
      .filter(m => m.name || m.rate !== '');
    // 只保存当前显示的填写项（取消某项活后，它对应的内容不再落库）
    const v = (f, x) => (sh[f] ? x : '');
    const growth = v('growth', d.growth.trim()), pest = v('pest', d.pest.trim()), machine = v('machine', d.machine.trim());
    const areaMu = v('area', d.areaMu), moisture = v('moisture', d.moisture.trim());
    const empty = !ops.length && !d.text.trim() && !moisture && !growth && !pest && !machine && !areaMu && !materials.length;
    if (empty) { U.toast('选一项活，或写几句'); return null; }
    const fert = materials.find(m => m.type === '化肥');
    return {
      id: d.id || undefined, seasonId: d.seasonId, date: d.date, ops, text: d.text.trim(),
      growth, pest, machine,
      areaMu: areaMu ? parseFloat(areaMu) : '',
      materials,
      // 旧字段同步写入首条化肥明细，兼容老版本读取
      fertName: fert ? fert.name : '', fertRate: fert && fert.rate !== '' ? fert.rate : '',
      moisture
    };
  },

  save() {
    const saved = this.persist();
    if (!saved) return;
    advisor.onLogSaved(saved, this.data.isEdit ? '' : this.data.taskId);
    U.toast(this.data.taskId && !this.data.isEdit ? '记好了，任务完成' : '记好了', 'success');
    setTimeout(() => wx.navigateBack(), 450);
  },

  // 农资用量 → 库存扣减（可在「类型管理 → 记事类型」关掉）
  // 编辑时先把上次扣的加回来，再按新值扣，避免重复扣
  applyStock(l, prevApplied) {
    return store.stock.applyLog(l, prevApplied);
  },

  // 统一落库（记事本身 + 库存扣减）
  persist() {
    const l = this.collect();
    if (!l) return null;
    const prev = l.id ? (store.logs.get(l.id) || {}).stockApplied : null;
    const applied = this.applyStock(l, prev);
    l.stockApplied = applied;
    return store.logs.save(l);
  },

  // 保存并关联一笔花费：按第一个设置了"默认记账类别"的记事类型带入
  saveWithCost() {
    const saved = this.persist();
    if (!saved) return;
    const l = saved;
    advisor.onLogSaved(saved, this.data.isEdit ? '' : this.data.taskId);
    const tag = l.ops.map(o => store.tags.logTag(o)).find(t => t && t.costCat);
    const cat = tag ? tag.costCat : 'agri';
    const sub = (tag && tag.costSub) || store.tags.cost(cat)[0] || '';
    const matText = l.materials.map(m => m.name + (m.rate !== '' ? ' ' + m.rate + m.unit : '')).join('、');
    const note = encodeURIComponent([l.ops.join('、'), matText].filter(Boolean).join(' · '));
    wx.redirectTo({
      url: '/pages/cost-edit/cost-edit?seasonId=' + l.seasonId + '&logId=' + saved.id + '&date=' + l.date +
        '&cat=' + cat + '&sub=' + encodeURIComponent(sub) + '&note=' + note + (l.areaMu ? '&mu=' + l.areaMu : '')
    });
  },

  del() {
    wx.showModal({
      title: '删除这条记事', content: '关联的账目会保留。', confirmText: '删除', confirmColor: '#B3372B',
      success: r => { if (r.confirm) { store.logs.remove(this.data.id); wx.navigateBack(); } }
    });
  }
});
