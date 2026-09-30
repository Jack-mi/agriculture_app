const store = require('../../utils/store.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');

Page({
  data: {
    id: '', seasonId: '', opsAll: [], ops: {}, text: '', date: '', today: '',
    dateStart: '', dateEnd: '',
    growth: '', pest: '', machine: '', areaMu: '',
    materials: [], materialTypes: C.MATERIAL_TYPES, materialUnits: C.MATERIAL_UNITS,
    moisture: '', moistQuick: C.MOISTURE, isEdit: false,
    w: null, seasonLabel: '', linkedCost: 0, plotId: ''
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
      wx.setNavigationBarTitle({ title: '修改记事' });
    } else {
      s = store.seasons.get(q.seasonId);
      this.setData({ seasonId: q.seasonId, date: q.date || U.today() });
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
    this.setData({ today: U.today(), seasonLabel: plot ? plot.name + ' · ' + C.cropOf(s.crop).name : '', plotId: s ? s.plotId : '' });
    this.showWx();
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

  onShow() { this.loadTags(); },

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
    this.setData({ ops });
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
  },
  onMatType(e) {
    const i = e.currentTarget.dataset.i, ti = +e.detail.value;
    this.setData({ ['materials[' + i + '].typeIndex']: ti, ['materials[' + i + '].type']: C.MATERIAL_TYPES[ti] });
  },
  onMatUnit(e) {
    const i = e.currentTarget.dataset.i, ui = +e.detail.value;
    this.setData({ ['materials[' + i + '].unitIndex']: ui, ['materials[' + i + '].unit']: C.MATERIAL_UNITS[ui] });
  },
  onMatName(e) { this.setData({ ['materials[' + e.currentTarget.dataset.i + '].name']: e.detail.value }); },
  onMatRate(e) { this.setData({ ['materials[' + e.currentTarget.dataset.i + '].rate']: e.detail.value }); },

  collect() {
    const d = this.data;
    const ops = d.opsAll.map(t => t.name).filter(o => d.ops[o]);
    const materials = d.materials
      .map(m => ({ type: m.type, name: (m.name || '').trim(), rate: m.rate !== '' ? parseFloat(m.rate) : '', unit: m.unit }))
      .filter(m => m.name || m.rate !== '');
    const empty = !ops.length && !d.text.trim() && !d.moisture.trim() && !d.growth.trim() &&
      !d.pest.trim() && !d.machine.trim() && !d.areaMu && !materials.length;
    if (empty) { U.toast('选一项活，或写几句'); return null; }
    const fert = materials.find(m => m.type === '化肥');
    return {
      id: d.id || undefined, seasonId: d.seasonId, date: d.date, ops, text: d.text.trim(),
      growth: d.growth.trim(), pest: d.pest.trim(), machine: d.machine.trim(),
      areaMu: d.areaMu ? parseFloat(d.areaMu) : '',
      materials,
      // 旧字段同步写入首条化肥明细，兼容老版本读取
      fertName: fert ? fert.name : '', fertRate: fert && fert.rate !== '' ? fert.rate : '',
      moisture: d.moisture.trim()
    };
  },

  save() {
    const l = this.collect();
    if (!l) return;
    store.logs.save(l);
    U.toast('记好了', 'success');
    setTimeout(() => wx.navigateBack(), 450);
  },

  // 保存并关联一笔花费：按第一个设置了"默认记账类别"的记事类型带入
  saveWithCost() {
    const l = this.collect();
    if (!l) return;
    const saved = store.logs.save(l);
    const tag = l.ops.map(o => store.tags.logTag(o)).find(t => t && t.costCat);
    const cat = tag ? tag.costCat : 'agri';
    const sub = (tag && tag.costSub) || store.tags.cost(cat)[0] || '';
    const matText = l.materials.map(m => m.name + (m.rate !== '' ? ' ' + m.rate + m.unit : '')).join('、');
    const note = encodeURIComponent([l.ops.join('、'), matText].filter(Boolean).join(' · '));
    wx.redirectTo({
      url: '/pages/cost-edit/cost-edit?seasonId=' + l.seasonId + '&logId=' + saved.id + '&date=' + l.date +
        '&cat=' + cat + '&sub=' + encodeURIComponent(sub) + '&note=' + note
    });
  },

  del() {
    wx.showModal({
      title: '删除这条记事', content: '关联的账目会保留。', confirmText: '删除', confirmColor: '#B3372B',
      success: r => { if (r.confirm) { store.logs.remove(this.data.id); wx.navigateBack(); } }
    });
  }
});
