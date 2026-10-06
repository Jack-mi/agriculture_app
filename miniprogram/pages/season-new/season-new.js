const store = require('../../utils/store.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');
const weather = require('../../utils/weather.js');

Page({
  data: {
    plots: [], plotId: '', crops: C.CROPS, crop: 'wheat', variety: '', varUsed: [], varList: [],
    sowDate: '', today: '', seedRate: '', tillage: '',
    tillageList: [],
    busyPlots: {}
  },

  onLoad(q) {
    const plots = store.plots.all();
    const busy = {};
    plots.forEach(p => { if (store.seasons.current(p.id)) busy[p.id] = true; });
    const free = plots.find(p => !busy[p.id]);
    // 按月份猜作物：8-12 月默认小麦（秋播），5-7 月默认玉米（夏播）
    const m = new Date().getMonth() + 1;
    this.setData({
      plots, busyPlots: busy,
      plotId: q.plotId || (free ? free.id : (plots[0] ? plots[0].id : '')),
      crop: (m >= 5 && m <= 7) ? 'corn' : 'wheat',
      sowDate: U.today(), today: U.today()
    });
    this.loadVarieties();
    this.loadTillage();
    if (!plots.length) {
      wx.showModal({ title: '还没有地块', content: '先添加一块地再开季', showCancel: false, success: () => wx.redirectTo({ url: '/pages/plot-edit/plot-edit' }) });
    }
  },

  pickPlot(e) { this.setData({ plotId: e.currentTarget.dataset.id }); },
  pickCrop(e) {
    const c = C.cropOf(e.currentTarget.dataset.key);
    if (!c.enabled) return U.toast(c.name + '后续开放');
    if (c.key === this.data.crop) return;
    this.setData({ crop: c.key, variety: '' });
    this.loadVarieties();
  },
  // 品种（二级类目）：选填；快捷选项 = 自己用过的 + 常见品种
  loadVarieties() {
    const v = store.seasons.varieties(this.data.crop);
    this.setData({ varUsed: v.used.slice(0, 4), varList: v.list });
  },
  onVariety(e) { this.setData({ variety: e.detail.value }); },
  pickVariety(e) {
    const v = e.currentTarget.dataset.v;
    this.setData({ variety: this.data.variety === v ? '' : v });
  },
  // 自己加一个品种：加进清单并直接选中（下次开季就能一键点）
  addVariety() {
    const crop = this.data.crop;
    wx.showModal({
      title: C.cropOf(crop).name + '品种', editable: true,
      placeholderText: crop === 'corn' ? '如：登海605、先玉335' : '如：济麦22、烟农1212',
      success: r => {
        if (!r.confirm) return;
        const name = (r.content || '').trim();
        if (!name) return U.toast('填个品种名');
        store.varieties.add(crop, name);
        this.setData({ variety: name.slice(0, 20) });
        this.loadVarieties();
      }
    });
  },
  delVariety(e) {
    const v = e.currentTarget.dataset.v;
    wx.showModal({
      title: '从清单里去掉', content: '「' + v + '」不再出现在品种快捷项里，已经开过的季不受影响。',
      success: r => { if (r.confirm) { store.varieties.remove(this.data.crop, v); this.loadVarieties(); } }
    });
  },
  onDate(e) { this.setData({ sowDate: e.detail.value }); },
  onSeed(e) { this.setData({ seedRate: e.detail.value }); },
  onTill(e) { this.setData({ tillage: e.detail.value }); },
  // 整地情况：快捷项也是用户自己的清单（可加可删）
  loadTillage() { this.setData({ tillageList: store.tillage.list() }); },
  appendTill(w) {
    const t = this.data.tillage;
    this.setData({ tillage: t ? (t.indexOf(w) >= 0 ? t : t + '、' + w) : w });
  },
  addTill(e) { this.appendTill(e.currentTarget.dataset.w); },
  addTillNew() {
    wx.showModal({
      title: '加一种整地方式', editable: true, placeholderText: '如：耙地、开沟、起垄',
      success: r => {
        if (!r.confirm) return;
        const name = (r.content || '').trim();
        if (!name) return U.toast('填个名称');
        store.tillage.add(name);
        this.loadTillage();
        this.appendTill(name.slice(0, 12));
      }
    });
  },
  delTill(e) {
    const w = e.currentTarget.dataset.w;
    wx.showModal({
      title: '去掉这一项', content: '「' + w + '」不再出现在快捷项里。',
      success: r => { if (r.confirm) { store.tillage.remove(w); this.loadTillage(); } }
    });
  },

  save() {
    const d = this.data;
    if (!d.plotId) return U.toast('请选择地块');
    if (d.busyPlots[d.plotId]) {
      return wx.showModal({ title: '这块地还有一季没收', content: '请先在那一季里登记收获，再开新一季。', showCancel: false });
    }
    const s = store.seasons.save({
      plotId: d.plotId, crop: d.crop, variety: d.variety.trim().slice(0, 20), sowDate: d.sowDate,
      seedRate: d.seedRate ? parseFloat(d.seedRate) : '', tillage: d.tillage.trim(), status: 'growing'
    });
    weather.fillSeason(s).catch(() => null);
    U.toast('开季成功', 'success');
    setTimeout(() => wx.redirectTo({ url: '/pages/season/season?id=' + s.id }), 500);
  }
});
