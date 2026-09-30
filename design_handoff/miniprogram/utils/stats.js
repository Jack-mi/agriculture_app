// 统计：成本汇总、积温、降雨
const U = require('./util.js');
const store = require('./store.js');
const C = require('./const.js');

// 成本：按 5 类汇总 + 合计（固定资产计入当季总成本）
function costSummary(seasonId) {
  const list = store.costs.bySeason(seasonId);
  const byCat = {};
  C.COST_CATS.forEach(c => { byCat[c.key] = { key: c.key, name: c.name, color: c.color, total: 0, count: 0, subs: {} }; });
  let total = 0;
  list.forEach(x => {
    const b = byCat[x.cat] || byCat.agri;
    b.total += x.amount; b.count += 1;
    const sub = x.sub || '其他';
    b.subs[sub] = (b.subs[sub] || 0) + x.amount;
    total += x.amount;
  });
  const cats = C.COST_CATS.map(c => {
    const b = byCat[c.key];
    return Object.assign(b, {
      totalText: U.money(b.total),
      pct: total ? Math.round(b.total / total * 1000) / 10 : 0,
      subList: Object.keys(b.subs).map(k => ({ name: k, amount: U.money(b.subs[k]) }))
    });
  });
  return { total, totalText: U.money(total), cats, count: list.length };
}

// 气象：逐日（当日值 + 累计）；积温 = 逐日平均气温累计总和（PRD 定义）
function weatherSeries(season) {
  const end = store.seasons.endDate(season);
  const today = U.today();
  const days = U.range(season.sowDate, end > today ? today : end);
  const w = store.weather.ofPlot(season.plotId);
  let gdd = 0, gdd0 = 0, rain = 0, known = 0, manual = 0;
  const rows = days.map(d => {
    const v = w[d];
    if (v) {
      gdd += v.t; gdd0 += Math.max(0, v.t); rain += v.p; known++;
      if (v.src === 'manual') manual++;
    }
    return {
      date: d, has: !!v,
      t: v ? U.round1(v.t) : null, p: v ? U.round1(v.p) : null,
      src: v ? v.src : '',
      gdd: U.round1(gdd), rain: U.round1(rain)
    };
  });
  return {
    rows, days: days.length, known, manual,
    gdd: U.round1(gdd), gdd0: U.round1(gdd0), rain: U.round1(rain),
    missing: days.length - known
  };
}

function seasonBrief(season) {
  const plot = store.plots.get(season.plotId) || {};
  const crop = C.cropOf(season.crop);
  const end = store.seasons.endDate(season);
  const cs = costSummary(season.id);
  const ws = weatherSeries(season);
  const dayN = U.diffDays(season.sowDate, end > U.today() ? U.today() : end) + 1;
  const perMu = plot.area ? cs.total / plot.area : 0;
  return {
    id: season.id, plotId: plot.id, plotName: plot.name || '未命名地块', area: plot.area,
    crop: crop.name, cropShort: crop.short, cropCls: crop.cls,
    status: season.status, sowDate: season.sowDate, sowText: U.cnDate(season.sowDate, true),
    harvestDate: season.harvestDate, dayN: dayN < 1 ? 0 : dayN,
    costTotal: cs.total, costText: cs.totalText, perMuText: perMu ? U.money(Math.round(perMu)) : '',
    gdd: ws.gdd, rain: ws.rain, logCount: store.logs.bySeason(season.id).length,
    yieldJin: season.yieldJin,
    yearLabel: seasonYearLabel(season)
  };
}

// "2026-2027 小麦" 这种跨年标签
function seasonYearLabel(s) {
  const y1 = s.sowDate.slice(0, 4);
  const y2 = (s.harvestDate || '').slice(0, 4);
  if (y2 && y2 !== y1) return y1 + '–' + y2;
  if (!y2 && s.crop === 'wheat') return y1 + '–' + (+y1 + 1);
  return y1;
}

module.exports = { costSummary, weatherSeries, seasonBrief, seasonYearLabel };
