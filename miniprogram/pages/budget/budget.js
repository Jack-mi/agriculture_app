// 预算：给某个种植季设 总预算 / 每亩目标 / 分类预算，并看进度
// 预算直接挂在 season 记录上（不新增云端集合），统计走 stats.budgetProgress
const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');

Page({
  data: { seasons: [], seasonNames: [], seasonIdx: 0, seasonId: '', seasonName: '', b: {}, prog: null, cats: [] },

  onLoad(opt) { if (opt && opt.seasonId) this.data.seasonId = opt.seasonId; },
  onShow() { this.render(); },

  render() {
    const all = store.seasons.all();
    if (!all.length) { this.setData({ seasons: [], prog: null, seasonName: '还没有种植季' }); return; }
    const names = all.map(s => {
      const p = store.plots.get(s.plotId) || {};
      return (p.name || '未命名地块') + ' · ' + C.cropOf(s.crop).name + (s.status === 'done' ? '（已收）' : '');
    });
    let idx = all.findIndex(s => s.id === this.data.seasonId);
    if (idx < 0) idx = 0;
    const s = all[idx];
    const bud = store.seasons.budget(s.id);
    const prog = stats.budgetProgress(s.id);
    this.setData({
      seasons: all, seasonNames: names, seasonIdx: idx, seasonId: s.id, seasonName: names[idx],
      b: { totalText: bud.total ? String(bud.total) : '', perMuText: bud.perMu ? String(bud.perMu) : '', cats: bud.cats || {} },
      prog: Object.assign(prog, { barW: Math.min(100, prog.pct), totalText2: U.money(prog.total) }),
      cats: (prog.cats || []).map(c => Object.assign(c, { barW: c.target ? Math.min(100, c.pct) : 0 }))
    });
  },

  pickSeason(e) { this.setData({ seasonId: this.data.seasons[+e.detail.value].id }); this.render(); },

  onIn(e) {
    const k = e.currentTarget.dataset.k;
    this.data.b[k + 'Text'] = e.detail.value;
  },
  onCat(e) {
    const k = e.currentTarget.dataset.k;
    const v = e.detail.value;
    const cats = Object.assign({}, this.data.b.cats);
    if (v === '' || +v === 0) delete cats[k]; else cats[k] = +v;
    this.data.b.cats = cats;
  },

  save() {
    const b = this.data.b;
    store.seasons.setBudget(this.data.seasonId, {
      total: parseFloat(b.totalText) || 0,
      perMu: parseFloat(b.perMuText) || 0,
      cats: b.cats || {}
    });
    U.toast('预算已保存');
    this.render();
  },

  goSeason() {
    if (!this.data.seasonId) return U.toast('还没有种植季');
    wx.navigateTo({ url: '/pages/season/season?id=' + this.data.seasonId + '&tab=cost' });
  }
});
