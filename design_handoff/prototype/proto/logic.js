// 谷雨记 · 网页原型逻辑层（与小程序 utils/ 同构：store / stats / weather）
(function () {
  const KEY = 'guyuji_proto_db_v1';
  const pad = n => (n < 10 ? '0' + n : '' + n);
  const fmt = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = s => { const p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  const U = {
    today: () => fmt(new Date()),
    addDays: (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); },
    diffDays: (a, b) => Math.round((parse(b) - parse(a)) / 86400000),
    range(a, b) { const o = []; if (!a || !b || a > b) return o; let c = a; while (c <= b) { o.push(c); c = U.addDays(c, 1); } return o; },
    cn: (s, y) => { const d = parse(s); return (y ? d.getFullYear() + '年' : '') + (d.getMonth() + 1) + '月' + d.getDate() + '日'; },
    week: s => '周' + '日一二三四五六'[parse(s).getDay()],
    money(n) { n = Math.round((+n || 0) * 100) / 100; return n.toFixed(n % 1 === 0 ? 0 : 2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); },
    r1: n => Math.round((+n || 0) * 10) / 10,
    uid: p => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  };

  const CROPS = [
    { key: 'wheat', name: '小麦', short: '麦', cls: 'wheat', enabled: true },
    { key: 'corn', name: '玉米', short: '玉', cls: 'corn', enabled: true },
    { key: 'peanut', name: '花生', short: '花', cls: 'other', enabled: false }
  ];
  const COST_CATS = [
    { key: 'agri', name: '农资投入', color: '#2E5B34', subs: ['种子', '农药', '化肥', '其他'] },
    { key: 'mach', name: '机械作业', color: '#C98B1E', subs: ['播种', '飞防', '收获', '运输', '其他'] },
    { key: 'trans', name: '运输成本', color: '#2F6F9F', subs: ['拉粮', '运输', '其他'] },
    { key: 'labor', name: '雇工成本', color: '#C4532B', subs: ['按天用工'] },
    { key: 'asset', name: '固定资产', color: '#6B5B95', subs: ['购买机械', '土地流转', '其他'] }
  ];
  const OPS = ['施肥', '打药', '浇水', '机械作业', '除草', '巡田', '其他'];
  const MOISTURE = ['干旱', '偏干', '适宜', '偏湿', '积水'];
  const OP_TO_COST = { '施肥': ['agri', '化肥'], '打药': ['agri', '农药'], '机械作业': ['mach', '其他'], '浇水': ['labor', '按天用工'], '除草': ['labor', '按天用工'] };
  const cropOf = k => CROPS.find(c => c.key === k) || CROPS[0];
  const catOf = k => COST_CATS.find(c => c.key === k) || COST_CATS[0];

  // ---------- store ----------
  let db = null;
  const listeners = new Set();
  function empty() { return { plots: [], seasons: [], costs: [], logs: [], weather: {} }; }
  function load() { try { db = JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { db = null; } if (!db) { db = seed(); save(); } return db; }
  function save() { localStorage.setItem(KEY, JSON.stringify(db)); listeners.forEach(f => f()); }
  function upsert(list, item, p) {
    if (!item.id) { item.id = U.uid(p); item.createdAt = Date.now(); db[list].push(item); }
    else { const i = db[list].findIndex(x => x.id === item.id); db[list][i] = Object.assign({}, db[list][i], item); }
    save(); return item;
  }
  const byDateDesc = (a, b) => (a.date === b.date ? b.createdAt - a.createdAt : (b.date > a.date ? 1 : -1));

  const S = {
    get db() { return db || load(); },
    subscribe(f) { listeners.add(f); return () => listeners.delete(f); },
    reset() { db = seed(); save(); },
    clear() { db = empty(); save(); },
    plots: {
      all: () => S.db.plots.slice().sort((a, b) => a.createdAt - b.createdAt),
      get: id => S.db.plots.find(p => p.id === id),
      save: p => upsert('plots', p, 'plot'),
      remove(id) {
        const sids = db.seasons.filter(s => s.plotId === id).map(s => s.id);
        db.seasons = db.seasons.filter(s => s.plotId !== id);
        db.costs = db.costs.filter(c => !sids.includes(c.seasonId));
        db.logs = db.logs.filter(c => !sids.includes(c.seasonId));
        db.plots = db.plots.filter(p => p.id !== id); delete db.weather[id]; save();
      }
    },
    seasons: {
      all: () => S.db.seasons.slice().sort((a, b) => (b.sowDate > a.sowDate ? 1 : -1)),
      growing: () => S.seasons.all().filter(s => s.status === 'growing'),
      byPlot: pid => S.seasons.all().filter(s => s.plotId === pid),
      current: pid => S.seasons.byPlot(pid).find(s => s.status === 'growing'),
      get: id => S.db.seasons.find(s => s.id === id),
      save: s => { if (!s.status) s.status = 'growing'; return upsert('seasons', s, 'season'); },
      remove(id) { db.seasons = db.seasons.filter(s => s.id !== id); db.costs = db.costs.filter(c => c.seasonId !== id); db.logs = db.logs.filter(c => c.seasonId !== id); save(); },
      endDate: s => (s.status === 'done' && s.harvestDate ? s.harvestDate : U.today())
    },
    costs: {
      bySeason: sid => S.db.costs.filter(c => c.seasonId === sid).sort(byDateDesc),
      get: id => S.db.costs.find(c => c.id === id),
      save: c => { c.amount = +c.amount || 0; return upsert('costs', c, 'cost'); },
      remove(id) { db.costs = db.costs.filter(c => c.id !== id); save(); }
    },
    logs: {
      bySeason: sid => S.db.logs.filter(c => c.seasonId === sid).sort(byDateDesc),
      get: id => S.db.logs.find(c => c.id === id),
      save: l => upsert('logs', l, 'log'),
      remove(id) { db.costs.forEach(c => { if (c.logId === id) c.logId = ''; }); db.logs = db.logs.filter(c => c.id !== id); save(); }
    },
    weather: {
      of: pid => (S.db.weather[pid] = S.db.weather[pid] || {}),
      get: (pid, d) => S.weather.of(pid)[d],
      putApi(pid, map) { const w = S.weather.of(pid); Object.keys(map).forEach(d => { if (w[d] && w[d].src === 'manual') return; w[d] = { t: map[d].t, p: map[d].p, src: 'api' }; }); save(); },
      setManual(pid, d, t, p) { S.weather.of(pid)[d] = { t: +t, p: +p, src: 'manual' }; save(); },
      reset(pid, d) { delete S.weather.of(pid)[d]; save(); }
    }
  };

  // ---------- 天气：Open-Meteo ----------
  async function om(url, params) {
    const q = new URLSearchParams(params).toString();
    const r = await fetch(url + '?' + q);
    if (!r.ok) throw new Error('http ' + r.status);
    const j = await r.json(); const d = j.daily; const m = {};
    (d.time || []).forEach((t, i) => { const v = d.temperature_2m_mean[i]; if (v === null || v === undefined) return; m[t] = { t: U.r1(v), p: U.r1(d.precipitation_sum[i] || 0) }; });
    return m;
  }
  async function fillSeason(s, force) {
    const plot = S.plots.get(s.plotId);
    if (!plot || plot.lat === '' || plot.lat == null) return { ok: false, reason: 'nolocation' };
    const today = U.today(); let end = S.seasons.endDate(s); if (end > today) end = today;
    const w = S.weather.of(plot.id);
    const days = U.range(s.sowDate, end);
    const miss = force ? days : days.filter(d => !w[d] || (w[d].src === 'api' && d >= U.addDays(today, -1)));
    if (!miss.length) return { ok: true, added: 0 };
    const base = { latitude: plot.lat, longitude: plot.lng, daily: 'temperature_2m_mean,precipitation_sum', timezone: 'Asia/Shanghai' };
    const recent = U.addDays(today, -30); const old = miss.filter(d => d < recent); const merged = {};
    const tasks = [];
    if (old.length) tasks.push(om('https://archive-api.open-meteo.com/v1/archive', Object.assign({}, base, { start_date: old[0], end_date: old[old.length - 1] })).then(m => Object.assign(merged, m)).catch(() => null));
    if (miss.some(d => d >= recent)) tasks.push(om('https://api.open-meteo.com/v1/forecast', Object.assign({}, base, { past_days: 31, forecast_days: 1 })).then(m => Object.keys(m).forEach(k => { if (k <= today) merged[k] = m[k]; })).catch(() => null));
    await Promise.all(tasks);
    const put = {}; Object.keys(merged).forEach(k => { if (k >= s.sowDate && k <= end) put[k] = merged[k]; });
    if (!Object.keys(put).length) return { ok: false, reason: 'network' };
    S.weather.putApi(plot.id, put); return { ok: true, added: Object.keys(put).length };
  }

  // ---------- stats ----------
  function costSummary(sid) {
    const list = S.costs.bySeason(sid); let total = 0;
    const cats = COST_CATS.map(c => ({ key: c.key, name: c.name, color: c.color, total: 0, count: 0, subs: {} }));
    list.forEach(x => { const b = cats.find(c => c.key === x.cat) || cats[0]; b.total += x.amount; b.count++; b.subs[x.sub || '其他'] = (b.subs[x.sub || '其他'] || 0) + x.amount; total += x.amount; });
    cats.forEach(b => { b.pct = total ? Math.round(b.total / total * 1000) / 10 : 0; });
    return { total, cats, count: list.length };
  }
  function weatherSeries(s) {
    let end = S.seasons.endDate(s); const today = U.today(); if (end > today) end = today;
    const w = S.weather.of(s.plotId); let gdd = 0, rain = 0, known = 0, manual = 0;
    const rows = U.range(s.sowDate, end).map(d => { const v = w[d]; if (v) { gdd += v.t; rain += v.p; known++; if (v.src === 'manual') manual++; } return { date: d, has: !!v, t: v ? v.t : null, p: v ? v.p : null, src: v ? v.src : '', gdd: U.r1(gdd), rain: U.r1(rain) }; });
    return { rows, days: rows.length, known, manual, missing: rows.length - known, gdd: U.r1(gdd), rain: U.r1(rain) };
  }
  function yearLabel(s) { const y1 = s.sowDate.slice(0, 4), y2 = (s.harvestDate || '').slice(0, 4); if (y2 && y2 !== y1) return y1 + '–' + y2; if (!y2 && s.crop === 'wheat' && +s.sowDate.slice(5, 7) >= 8) return y1 + '–' + (+y1 + 1); return y1; }
  function brief(s) {
    const plot = S.plots.get(s.plotId) || {}; const crop = cropOf(s.crop); const cs = costSummary(s.id); const ws = weatherSeries(s);
    let end = S.seasons.endDate(s); if (end > U.today()) end = U.today();
    return { id: s.id, plot, crop, s, dayN: Math.max(0, U.diffDays(s.sowDate, end) + 1), cost: cs.total, perMu: plot.area ? cs.total / plot.area : 0, gdd: ws.gdd, rain: ws.rain, label: yearLabel(s) };
  }

  // ---------- 演示数据（荣成） ----------
  function seed() {
    const d = empty(); const t = U.today(); let n = 0; const ts = () => Date.now() - 100000 + (n++);
    const LAT = 37.165, LNG = 122.486;
    const p1 = { id: 'plot_a', name: '村东大块', area: 52, lat: LAT, lng: LNG, address: '荣成市 · 村东', createdAt: 1 };
    const p2 = { id: 'plot_b', name: '河边地', area: 28, lat: 37.142, lng: 122.431, address: '荣成市 · 河边', createdAt: 2 };
    d.plots.push(p1, p2);
    const wOld = { id: 's_w25', plotId: 'plot_a', crop: 'wheat', sowDate: U.addDays(t, -355), seedRate: 30, tillage: '玉米秸秆还田，旋耕两遍后镇压', status: 'done', harvestDate: U.addDays(t, -110), yieldJin: 46800, harvestNote: '卖给粮站 1.18元/斤', createdAt: ts() };
    const corn = { id: 's_c26', plotId: 'plot_a', crop: 'corn', sowDate: U.addDays(t, -105), seedRate: 4, tillage: '麦茬免耕直播', status: 'growing', createdAt: ts() };
    const wNew = { id: 's_w26', plotId: 'plot_b', crop: 'wheat', sowDate: U.addDays(t, -4), seedRate: 32, tillage: '深翻一遍、旋耕一遍', status: 'growing', createdAt: ts() };
    d.seasons.push(wOld, corn, wNew);
    const C = (sid, off, cat, sub, amount, note, extra) => d.costs.push(Object.assign({ id: U.uid('cost'), seasonId: sid, date: U.addDays(t, off), cat, sub, amount, note, createdAt: ts() }, extra || {}));
    const L = (sid, off, ops, text, extra) => { const l = Object.assign({ id: U.uid('log'), seasonId: sid, date: U.addDays(t, off), ops, text, createdAt: ts() }, extra || {}); d.logs.push(l); return l; };
    // 玉米季
    C('s_c26', -106, 'agri', '种子', 3120, '登海605 共 52 袋');
    C('s_c26', -105, 'mach', '播种', 1560, '老刘家播种机，30元/亩');
    C('s_c26', -104, 'agri', '化肥', 5980, '复合肥 46 袋');
    C('s_c26', -100, 'asset', '土地流转', 18200, '村东大块 350元/亩·年，按季分摊');
    const lf = L('s_c26', -62, ['施肥'], '大喇叭口期追肥', { fertName: '尿素', fertRate: 30 });
    C('s_c26', -62, 'agri', '化肥', 2860, '尿素 26 袋', { logId: lf.id });
    C('s_c26', -62, 'labor', '按天用工', 600, '3 人追肥', { people: 3, unitPrice: 200 });
    const ld = L('s_c26', -48, ['打药', '机械作业'], '雇张家无人机飞防，一遍玉米螟+叶斑病', {});
    C('s_c26', -48, 'mach', '飞防', 780, '无人机 15元/亩', { logId: ld.id });
    C('s_c26', -48, 'agri', '农药', 1320, '氯虫苯甲酰胺+吡唑醚菌酯', { logId: ld.id });
    L('s_c26', -30, ['巡田'], '雨后看了一圈，东头有点倒伏', { moisture: '偏湿' });
    L('s_c26', -8, ['巡田'], '乳线过半，再有十来天能收', { moisture: '适宜' });
    L('s_c26', 0, ['巡田', '其他'], '联系好了收割机，下周二来', {});
    // 小麦新季
    C('s_w26', -5, 'agri', '种子', 2016, '济麦 22，32斤/亩');
    C('s_w26', -4, 'mach', '播种', 840, '旋耕+播种一体');
    C('s_w26', -4, 'agri', '化肥', 3080, '底肥复合肥');
    L('s_w26', -4, ['机械作业', '施肥'], '旋耕播种一体机，底肥一起下', { fertName: '复合肥 15-15-15', fertRate: 50, moisture: '适宜' });
    // 去年小麦
    [['agri', '种子', 3380], ['mach', '播种', 1560], ['agri', '化肥', 7020], ['agri', '农药', 2140], ['mach', '飞防', 1560], ['labor', '按天用工', 1800], ['mach', '收获', 3640], ['trans', '拉粮', 1400], ['asset', '土地流转', 18200]]
      .forEach((x, i) => C('s_w25', -355 + i * 30, x[0], x[1], x[2], ''));
    L('s_w25', -300, ['浇水'], '冬前浇越冬水', { moisture: '偏干' });
    L('s_w25', -180, ['施肥', '浇水'], '返青追肥浇水', { fertName: '尿素', fertRate: 25 });
    return d;
  }

  window.GY = { U, S, CROPS, COST_CATS, OPS, MOISTURE, OP_TO_COST, cropOf, catOf, fillSeason, costSummary, weatherSeries, brief, yearLabel, load };
})();
