const store = require('../../utils/store.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');

// 操作 → 一键关联记账时的默认类别
const OP_TO_COST = {
  '施肥': { cat: 'agri', sub: '化肥' },
  '打药': { cat: 'agri', sub: '农药' },
  '机械作业': { cat: 'mach', sub: '其他' },
  '浇水': { cat: 'labor', sub: '按天用工' },
  '除草': { cat: 'labor', sub: '按天用工' }
};

Page({
  data: {
    id: '', seasonId: '', opsAll: C.OPS, ops: {}, text: '', date: '', today: '',
    fertName: '', fertRate: '', moisture: '', moistQuick: C.MOISTURE, isEdit: false,
    w: null, seasonLabel: '', linkedCost: 0
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
        fertName: l.fertName || '', fertRate: l.fertRate ? String(l.fertRate) : '', moisture: l.moisture || '', isEdit: true,
        linkedCost: store.db().costs.filter(c => c.logId === l.id).reduce((a, c) => a + c.amount, 0)
      });
      wx.setNavigationBarTitle({ title: '修改记事' });
    } else {
      s = store.seasons.get(q.seasonId);
      this.setData({ seasonId: q.seasonId, date: U.today() });
    }
    const plot = s && store.plots.get(s.plotId);
    this.setData({ today: U.today(), seasonLabel: plot ? plot.name + ' · ' + C.cropOf(s.crop).name : '', plotId: s ? s.plotId : '' });
    this.showWx();
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
  onText(e) { this.setData({ text: e.detail.value }); },
  onDate(e) { this.setData({ date: e.detail.value }); this.showWx(); },
  onFert(e) { this.setData({ fertName: e.detail.value }); },
  onRate(e) { this.setData({ fertRate: e.detail.value }); },
  onMoist(e) { this.setData({ moisture: e.detail.value }); },
  pickMoist(e) { this.setData({ moisture: e.currentTarget.dataset.m }); },

  collect() {
    const d = this.data;
    const ops = C.OPS.filter(o => d.ops[o]);
    if (!ops.length && !d.text.trim() && !d.moisture.trim()) { U.toast('选一项活，或写几句'); return null; }
    return {
      id: d.id || undefined, seasonId: d.seasonId, date: d.date, ops, text: d.text.trim(),
      fertName: d.ops['施肥'] ? d.fertName.trim() : '', fertRate: d.ops['施肥'] && d.fertRate ? parseFloat(d.fertRate) : '',
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

  // 保存并关联一笔花费（PRD：涉及费用的操作可一键关联记账）
  saveWithCost() {
    const l = this.collect();
    if (!l) return;
    const saved = store.logs.save(l);
    const first = l.ops.find(o => OP_TO_COST[o]);
    const m = first ? OP_TO_COST[first] : { cat: 'agri', sub: '其他' };
    const note = encodeURIComponent([l.ops.join('、'), l.fertName].filter(Boolean).join(' · '));
    wx.redirectTo({
      url: '/pages/cost-edit/cost-edit?seasonId=' + l.seasonId + '&logId=' + saved.id + '&date=' + l.date +
        '&cat=' + m.cat + '&sub=' + encodeURIComponent(m.sub) + '&note=' + note
    });
  },

  del() {
    wx.showModal({
      title: '删除这条记事', content: '关联的账目会保留。', confirmText: '删除', confirmColor: '#B3372B',
      success: r => { if (r.confirm) { store.logs.remove(this.data.id); wx.navigateBack(); } }
    });
  }
});
