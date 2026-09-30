const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const weather = require('../../utils/weather.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');

Page({
  data: {
    id: '', tab: 'cost', brief: {}, season: {}, plot: {},
    cost: { cats: [], total: 0 }, costList: [], openCat: '',
    logGroups: [], met: {}, bars: [], seasonInfo: {}, wxRows: [], wxLoading: false, wxMsg: '',
    edit: null
  },

  onLoad(q) { this.setData({ id: q.id, tab: q.tab || 'cost' }); },
  onShow() { this.render(); this.loadWeather(); },

  render() {
    const s = store.seasons.get(this.data.id);
    if (!s) { wx.navigateBack(); return; }
    const plot = store.plots.get(s.plotId) || {};
    const brief = stats.seasonBrief(s);
    wx.setNavigationBarTitle({ title: plot.name + ' · ' + brief.crop });

    const cost = stats.costSummary(s.id);
    const costList = store.costs.bySeason(s.id).map(c => ({
      id: c.id, date: c.date, dateText: U.cnDate(c.date), cat: c.cat, catName: C.catOf(c.cat).name,
      color: C.catOf(c.cat).color, sub: c.sub, note: c.note,
      people: c.people, amount: U.money(c.amount), linked: !!c.logId
    }));

    // 记事按日期分组
    const groups = {};
    store.logs.bySeason(s.id).forEach(l => {
      (groups[l.date] = groups[l.date] || []).push({
        id: l.id, ops: (l.ops || []).join(' · '), text: l.text,
        fert: l.fertName ? (l.fertName + (l.fertRate ? ' ' + l.fertRate + ' 斤/亩' : '')) : '',
        moisture: l.moisture,
        cost: store.db().costs.filter(c => c.logId === l.id).reduce((a, c) => a + c.amount, 0)
      });
    });
    const logGroups = Object.keys(groups).sort().reverse().map(d => {
      const w = store.weather.get(s.plotId, d);
      return {
        date: d, dateText: U.cnDate(d), week: U.weekday(d), dayN: U.diffDays(s.sowDate, d) + 1,
        w: w ? w.t + '℃ · ' + w.p + 'mm' : '',
        items: groups[d].map(x => Object.assign(x, { costText: x.cost ? U.money(x.cost) : '' }))
      };
    });

    const ws = stats.weatherSeries(s);
    const wxRows = ws.rows.slice().reverse().map(r => Object.assign(r, {
      dateText: U.cnDate(r.date), dayN: U.diffDays(s.sowDate, r.date) + 1,
      tText: r.has ? r.t : '—', pText: r.has ? r.p : '—'
    }));
    // 降雨柱状（近 30 天）
    const last = ws.rows.slice(-30);
    const maxP = Math.max(5, ...last.map(r => r.p || 0));
    const bars = last.map(r => ({ d: r.date.slice(5), h: r.p ? Math.max(4, Math.round(r.p / maxP * 100)) : 0, p: r.p }));

    this.setData({
      season: s, plot, brief, cost, costList, logGroups,
      met: { gdd: ws.gdd, gdd0: ws.gdd0, rain: ws.rain, days: ws.days, known: ws.known, missing: ws.missing, manual: ws.manual, hasLoc: plot.lat !== undefined && plot.lat !== '' },
      wxRows, bars,
      seasonInfo: {
        sow: U.cnDate(s.sowDate, true), seed: s.seedRate ? s.seedRate + ' 斤/亩' : '未填',
        tillage: s.tillage || '未填',
        harvest: s.harvestDate ? U.cnDate(s.harvestDate, true) : '',
        yieldText: s.yieldJin ? U.money(s.yieldJin) + ' 斤' : '',
        perMuYield: s.yieldJin && plot.area ? U.money(Math.round(s.yieldJin / plot.area)) + ' 斤/亩' : '',
        costPerJin: s.yieldJin && cost.total ? (cost.total / s.yieldJin).toFixed(2) + ' 元/斤' : ''
      }
    });
  },

  loadWeather(force) {
    const s = store.seasons.get(this.data.id);
    if (!s) return;
    this.setData({ wxLoading: true, wxMsg: '' });
    weather.fillSeason(s, { force }).then(r => {
      let msg = '';
      if (!r.ok && r.reason === 'nolocation') msg = '地块未定位，无法自动获取天气';
      else if (!r.ok) msg = '网络不好，天气稍后自动补齐';
      this.setData({ wxLoading: false, wxMsg: msg });
      this.render();
    }).catch(() => this.setData({ wxLoading: false }));
  },

  setTab(e) { this.setData({ tab: e.currentTarget.dataset.t }); },
  toggleCat(e) { const k = e.currentTarget.dataset.k; this.setData({ openCat: this.data.openCat === k ? '' : k }); },

  addCost() { wx.navigateTo({ url: '/pages/cost-edit/cost-edit?seasonId=' + this.data.id }); },
  editCost(e) { wx.navigateTo({ url: '/pages/cost-edit/cost-edit?id=' + e.currentTarget.dataset.id }); },
  addLog() { wx.navigateTo({ url: '/pages/log-edit/log-edit?seasonId=' + this.data.id }); },
  editLog(e) { wx.navigateTo({ url: '/pages/log-edit/log-edit?id=' + e.currentTarget.dataset.id }); },
  harvest() { wx.navigateTo({ url: '/pages/harvest/harvest?id=' + this.data.id }); },
  goPlot() { wx.navigateTo({ url: '/pages/plot-edit/plot-edit?id=' + this.data.season.plotId }); },
  refreshWx() { this.loadWeather(true); },

  // 手工修正天气
  editWx(e) {
    const r = this.data.wxRows[e.currentTarget.dataset.i];
    this.setData({ edit: { date: r.date, dateText: U.cnDate(r.date, true), t: r.has ? String(r.t) : '', p: r.has ? String(r.p) : '', src: r.src } });
  },
  onEditT(e) { this.setData({ 'edit.t': e.detail.value }); },
  onEditP(e) { this.setData({ 'edit.p': e.detail.value }); },
  closeEdit() { this.setData({ edit: null }); },
  noop() {},
  saveEdit() {
    const ed = this.data.edit;
    const t = parseFloat(ed.t), p = parseFloat(ed.p);
    if (isNaN(t)) return U.toast('请填写平均气温');
    store.weather.setManual(this.data.season.plotId, ed.date, t, isNaN(p) ? 0 : p);
    this.setData({ edit: null });
    this.render();
    U.toast('已修正', 'success');
  },
  resetEdit() {
    store.weather.resetToApi(this.data.season.plotId, this.data.edit.date);
    this.setData({ edit: null });
    this.loadWeather();
  },

  delSeason() {
    wx.showModal({
      title: '删除这一季', content: '这一季的所有账目和记事都会删除，不能恢复。', confirmText: '删除', confirmColor: '#B3372B',
      success: r => { if (r.confirm) { store.seasons.remove(this.data.id); wx.navigateBack(); } }
    });
  },
  reopen() {
    wx.showModal({
      title: '撤销收获', content: '恢复为"在种"状态？', success: r => {
        if (!r.confirm) return;
        if (store.seasons.current(this.data.season.plotId)) return U.toast('这块地已有在种的季');
        store.seasons.save({ id: this.data.id, status: 'growing', harvestDate: '' });
        this.render();
      }
    });
  },

  onShareAppMessage() {
    const b = this.data.brief;
    return { title: b.plotName + ' ' + b.crop + ' · 已投入¥' + b.costText, path: '/pages/index/index' };
  }
});
