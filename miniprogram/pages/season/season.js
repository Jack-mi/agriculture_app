const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const weather = require('../../utils/weather.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');

Page({
  data: {
    id: '', tab: 'cost', brief: {}, season: {}, plot: {},
    cost: { cats: [], total: 0 }, costList: [], openCat: '',
    logGroups: [], costFilter: '', logFilter: '', costSubs: [], logTags: [], met: {}, bars: [], seasonInfo: {}, wxRows: [], wxLoading: false, wxMsg: '',
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
    const cf = this.data.costFilter, lf = this.data.logFilter;
    const allCosts = store.costs.bySeason(s.id);
    // 筛选胶囊：本季出现过的细分类型
    const costSubs = []; allCosts.forEach(c => { const k = c.cat + '|' + c.sub; if (c.sub && !costSubs.some(x => x.k === k)) costSubs.push({ k, name: c.sub, color: C.catOf(c.cat).color }); });
    const costList = allCosts.filter(c => !cf || (c.cat + '|' + c.sub) === cf).map(c => ({
      id: c.id, date: c.date, dateText: U.cnDate(c.date), cat: c.cat, catName: C.catOf(c.cat).name,
      color: C.catOf(c.cat).color, sub: c.sub, note: c.note,
      people: c.people, amount: U.money(store.costs.amountFor(c, s.id)),
      shared: store.costs.allocOf(c).length > 1, linked: !!c.logId
    }));

    // 全生育周期连续日历：播种日 → 收获日/今天，倒序；无记录日期显示「本日未记录」
    const allLogs = store.logs.bySeason(s.id);
    const logTags = []; allLogs.forEach(l => (l.ops || []).forEach(o => { if (!logTags.some(t => t.name === o)) logTags.push({ name: o, color: store.tags.colorOf(o) }); }));
    const matText = l => store.logs.materialsOf(l).map(m => (m.type !== '化肥' || !m.name ? m.type + (m.name ? '·' + m.name : '') : m.name) + (m.rate !== '' && m.rate !== undefined ? ' ' + m.rate + m.unit : '')).join('、');
    const logGroups = stats.logCalendar(s).reverse().map(day => {
      const items = day.logs.filter(l => !lf || (l.ops || []).indexOf(lf) >= 0).map(l => {
        const cost = store.db().costs.filter(c => c.logId === l.id).reduce((a, c) => a + store.costs.amountFor(c, s.id), 0);
        return {
          id: l.id, opTags: (l.ops || []).map(o => ({ name: o, color: store.tags.colorOf(o) })), text: l.text,
          growth: l.growth || '', pest: l.pest || '', machine: l.machine || '',
          areaMu: l.areaMu ? l.areaMu + ' 亩' : '',
          materials: matText(l),
          moisture: l.moisture,
          costText: cost ? U.money(cost) : ''
        };
      });
      const w = day.weather;
      return {
        date: day.date, dateText: U.cnDate(day.date), week: U.weekday(day.date), dayN: day.dayN,
        w: w ? w.t + '℃ · ' + w.p + 'mm' + (w.wind !== undefined && w.wind !== null && w.wind !== '' ? ' · 风' + w.wind + 'm/s' : '') : '',
        items, empty: !items.length
      };
    }).filter(g => !lf || !g.empty);

    const ws = stats.weatherSeries(s);
    const wxRows = ws.rows.slice().reverse().map(r => Object.assign(r, {
      dateText: U.cnDate(r.date), dayN: U.diffDays(s.sowDate, r.date) + 1,
      tText: r.has ? r.t : '—', pText: r.has ? r.p : '—', windText: r.wind !== null ? r.wind : '—'
    }));
    // 降雨柱状（近 30 天）
    const last = ws.rows.slice(-30);
    const maxP = Math.max(5, ...last.map(r => r.p || 0));
    const bars = last.map(r => ({ d: r.date.slice(5), h: r.p ? Math.max(4, Math.round(r.p / maxP * 100)) : 0, p: r.p }));

    this.setData({
      season: s, plot, brief, cost, costList, logGroups, costSubs, logTags, costTotalCount: allCosts.length,
      costFilterSum: cf ? U.money(allCosts.filter(c => (c.cat + '|' + c.sub) === cf).reduce((a, c) => a + store.costs.amountFor(c, s.id), 0)) : '',
      met: { gdd: ws.gdd, gdd0: ws.gdd0, rain: ws.rain, days: ws.days, known: ws.known, missing: ws.missing, manual: ws.manual, maxWind: ws.maxWind, hasLoc: plot.lat !== undefined && plot.lat !== '' },
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

  setCostFilter(e) { const k = e.currentTarget.dataset.k || ''; this.setData({ costFilter: this.data.costFilter === k ? '' : k }); this.render(); },
  setLogFilter(e) { const k = e.currentTarget.dataset.k || ''; this.setData({ logFilter: this.data.logFilter === k ? '' : k }); this.render(); },
  goTags() { wx.navigateTo({ url: '/pages/tags/tags?tab=' + (this.data.tab === 'log' ? 'log' : 'cost') }); },
  setTab(e) { this.setData({ tab: e.currentTarget.dataset.t }); },
  toggleCat(e) { const k = e.currentTarget.dataset.k; this.setData({ openCat: this.data.openCat === k ? '' : k }); },

  addCost() { wx.navigateTo({ url: '/pages/cost-edit/cost-edit?seasonId=' + this.data.id }); },
  editCost(e) { wx.navigateTo({ url: '/pages/cost-edit/cost-edit?id=' + e.currentTarget.dataset.id }); },
  addLog() { wx.navigateTo({ url: '/pages/log-edit/log-edit?seasonId=' + this.data.id }); },
  addLogAt(e) { wx.navigateTo({ url: '/pages/log-edit/log-edit?seasonId=' + this.data.id + '&date=' + e.currentTarget.dataset.date }); },
  editLog(e) { wx.navigateTo({ url: '/pages/log-edit/log-edit?id=' + e.currentTarget.dataset.id }); },
  harvest() { wx.navigateTo({ url: '/pages/harvest/harvest?id=' + this.data.id }); },
  goPlot() { wx.navigateTo({ url: '/pages/plot-edit/plot-edit?id=' + this.data.season.plotId }); },
  refreshWx() { this.loadWeather(true); },

  // 手工修正天气
  editWx(e) {
    const r = this.data.wxRows[e.currentTarget.dataset.i];
    this.setData({ edit: { date: r.date, dateText: U.cnDate(r.date, true), t: r.has ? String(r.t) : '', p: r.has ? String(r.p) : '', wind: r.wind !== null ? String(r.wind) : '', src: r.src } });
  },
  onEditT(e) { this.setData({ 'edit.t': e.detail.value }); },
  onEditP(e) { this.setData({ 'edit.p': e.detail.value }); },
  onEditWind(e) { this.setData({ 'edit.wind': e.detail.value }); },
  closeEdit() { this.setData({ edit: null }); },
  noop() {},
  saveEdit() {
    const ed = this.data.edit;
    const t = parseFloat(ed.t), p = parseFloat(ed.p);
    if (isNaN(t)) return U.toast('请填写平均气温');
    store.weather.setManual(this.data.season.plotId, ed.date, t, isNaN(p) ? 0 : p, ed.wind);
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
      title: '删除这一季', content: '这一季的记事会删除；只分摊到这一季的账目也会删除，多季共用的账目保留其他季的分摊。', confirmText: '删除', confirmColor: '#B3372B',
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
