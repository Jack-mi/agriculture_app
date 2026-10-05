// 报表：收支总览 + 支出结构 + 月度趋势 + 按作物（时间口径可切）
// 全部由 stats 纯函数本地算，图表用 CSS 柱/占比条，不引图表库
const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const C = require('../../utils/const.js');
const U = require('../../utils/util.js');

const SCOPES = [{ k: 'year', n: '今年' }, { k: 'season', n: '本季' }, { k: 'month', n: '本月' }, { k: 'all', n: '全部' }];

Page({
  data: { scopes: SCOPES, scope: 'year', scopeName: '今年', ov: {}, rows: [], st: {}, trend: [], debt: {}, periodText: '', trendTitle: '' },

  onShow() { this.render(); },

  render() {
    const scope = this.data.scope, today = U.today();
    const g = store.seasons.growing()[0];
    const season = scope === 'season' ? (g || store.seasons.all()[0]) : null;
    const opt = { today, season };
    const filter = stats.scopeFilter(scope, opt);
    const ov = stats.overview(filter, opt);
    const st = stats.structureOf(filter);
    const trend = stats.monthlyTrend(6, stats.scopeFilter('all'), today);
    const rows = stats.bySeasonRows(filter).map(r => Object.assign(r, {
      netText: (r.net >= 0 ? '＋¥' : '−¥') + U.money(Math.abs(r.net)),
      incomeText: '¥' + r.incomeText, expenseText: '¥' + r.expenseText,
      perMuText: r.area ? '¥' + r.perMuNet + '/亩' : ''
    }));
    const ds = stats.debtSummary();
    const bSeason = season || g;
    const bud = bSeason ? stats.budgetProgress(bSeason.id) : null;
    const acc = stats.accountRows(filter);
    const bs = stats.balanceSheet();
    const scopeName = this.data.scopes.find(x => x.k === scope).n + (season ? ' · ' + (store.plots.get(season.plotId) || {}).name : '');
    const period = scope === 'month' ? today.slice(0, 7) : scope === 'year' ? today.slice(0, 4) + ' 年' : scope === 'all' ? '全部时间' : (season ? season.sowDate + ' ~' : '');
    this.setData({
      ov: Object.assign(ov, {
        netText2: (ov.net >= 0 ? '＋¥' : '−¥') + U.money(Math.abs(ov.net)),
        inPct: ov.income + ov.expense ? Math.round(ov.income / (ov.income + ov.expense) * 100) : 0
      }),
      st, trend, rows, scopeName,
      periodText: period,
      trendTitle: '月度趋势（近 6 个月）',
      debt: {
        payableText: ds.payable.totalText, receivableText: ds.receivable.totalText,
        payable: ds.payable.total, receivable: ds.receivable.total,
        count: ds.receivable.count + ds.payable.count
      },
      budget: bud ? Object.assign(bud, { barW: Math.min(100, bud.pct), totalText2: U.money(bud.total) }) : null,
      acc, bs
    });
  },

  setScope(e) { this.setData({ scope: e.currentTarget.dataset.k }); this.render(); },
  goLedger() { wx.switchTab({ url: '/pages/ledger/ledger' }); },
  goDebt() { wx.navigateTo({ url: '/pages/debt/debt' }); },
  goBudget() {
    const g = store.seasons.growing()[0] || store.seasons.all()[0];
    if (!g) return U.toast('还没有种植季');
    wx.navigateTo({ url: '/pages/budget/budget?seasonId=' + g.id });
  },
  goFunds() { wx.navigateTo({ url: '/pages/funds/funds' }); },
  goBalance() { wx.navigateTo({ url: '/pages/balance/balance' }); },
  goSeason() {
    const g = store.seasons.growing()[0] || store.seasons.all()[0];
    if (!g) return U.toast('还没有种植季');
    wx.navigateTo({ url: '/pages/season/season?id=' + g.id + '&tab=cost' });
  }
});
