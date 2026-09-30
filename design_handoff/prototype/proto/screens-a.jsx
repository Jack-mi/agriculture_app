/* 谷雨记 原型 · 页面 A：今天 / 地块 / 我的 / 地块编辑 / 开季 */
const { useState, useEffect } = React;
const { U, S } = window.GY;

function useDB() {
  const [, set] = useState(0);
  useEffect(() => S.subscribe(() => set(x => x + 1)), []);
}

function HomePage({ nav, ui }) {
  useDB();
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    Promise.all(S.seasons.growing().map(s => GY.fillSeason(s).catch(() => null))).then(() => setLoading(false));
  }, []);
  const t = U.today();
  const hasPlots = S.plots.all().length > 0;
  const cards = S.seasons.growing().map(s => {
    const b = GY.brief(s);
    const w = S.weather.get(s.plotId, t) || S.weather.get(s.plotId, U.addDays(t, -1));
    const tl = S.logs.bySeason(s.id).filter(l => l.date === t);
    const tc = S.costs.bySeason(s.id).filter(c => c.date === t).reduce((a, c) => a + c.amount, 0);
    return { b, w, tl, tc };
  });
  return (
    <div className="page">
      <div className="hero">
        <div className="hero-d">{U.cn(t)}<small>{U.week(t)}</small></div>
        <div className="hero-s">今天地里干了啥、花了多少，随手记一笔</div>
      </div>
      <div className="wrap lift">
        {!hasPlots && <div className="card empty"><div className="big">先添加第一块地</div><div className="muted" style={{ marginBottom: 20 }}>填上名称、亩数，定个位置，就能自动记天气</div><div className="btn" onClick={() => nav.go('plotEdit')}>＋ 添加地块</div></div>}
        {hasPlots && !cards.length && <div className="card empty"><div className="big">还没有在种的作物</div><div className="muted" style={{ marginBottom: 20 }}>开一季：选地块、选作物、填播种日</div><div className="btn" onClick={() => nav.go('seasonNew')}>＋ 开始新一季</div></div>}
        {cards.map(({ b, w, tl, tc }) => (
          <div className="sc" key={b.id}>
            <div className="sc-top" onClick={() => nav.go('season', { id: b.id })}>
              <div className={'crop ' + b.crop.cls}>{b.crop.short}</div>
              <div className="f1" style={{ marginLeft: 12 }}>
                <div className="sc-name">{b.plot.name}<span className="tag">{b.crop.name}</span></div>
                <div className="muted">{b.plot.area} 亩 · 播种第 <b className="num" style={{ color: 'var(--ink)', fontSize: 17 }}>{b.dayN}</b> 天</div>
              </div>
              <div className="arrow">›</div>
            </div>
            <div className="wxr">
              <div className="wxc"><div className="k">今日均温</div><div className="v num heat">{w ? w.t : '--'}<small>℃</small></div></div>
              <div className="wxc"><div className="k">今日降雨</div><div className="v num rain">{w ? w.p : '--'}<small>mm</small></div></div>
              <div className="wxc"><div className="k">累计积温</div><div className="v num">{b.gdd}<small>℃·d</small></div></div>
              <div className="wxc"><div className="k">累计降雨</div><div className="v num">{b.rain}<small>mm</small></div></div>
            </div>
            <div className="tot"><span className="muted">本季已投入</span><b className="num">¥{U.money(b.cost)}</b>{b.perMu > 0 && <span className="muted"> · ¥{U.money(Math.round(b.perMu))}/亩</span>}</div>
            {(tl.length > 0 || tc > 0) && <div className="tdone">✓ 今天已记：{tl.map(l => (l.ops || []).join('、') || '记事').join('；')}{tc ? ' · 花费 ¥' + U.money(tc) : ''}</div>}
            <div className="acts">
              <div className="btn wheat" onClick={() => nav.go('costEdit', { seasonId: b.id })}>记一笔账</div>
              <div className="btn" onClick={() => nav.go('logEdit', { seasonId: b.id })}>记今天的活</div>
            </div>
          </div>
        ))}
        {cards.length > 0 && <div className="btn ghost" onClick={() => nav.go('seasonNew')}>＋ 开始新一季</div>}
        {loading && <div className="muted" style={{ textAlign: 'center', marginTop: 12 }}>正在更新天气…</div>}
      </div>
    </div>
  );
}

function PlotsPage({ nav }) {
  useDB();
  const list = S.plots.all();
  const total = U.r1(list.reduce((a, p) => a + (+p.area || 0), 0));
  return (
    <div className="page wrap">
      <div className="row between" style={{ margin: '4px 4px 12px' }}>
        <div><b className="num" style={{ fontSize: 22 }}>{list.length}</b><span className="muted"> 块地 · 共 </span><b className="num" style={{ fontSize: 22 }}>{total}</b><span className="muted"> 亩</span></div>
        <div className="btn small" onClick={() => nav.go('plotEdit')}>＋ 添加</div>
      </div>
      {!list.length && <div className="card empty"><div className="big">还没有地块</div><div className="muted">点右上角「添加」开始</div></div>}
      {list.map(p => {
        const ss = S.seasons.byPlot(p.id); const cur = ss.find(s => s.status === 'growing'); const cb = cur && GY.brief(cur);
        const hasLoc = p.lat !== '' && p.lat != null;
        return (
          <div className="card" key={p.id}>
            <div className="row between" style={{ cursor: 'pointer' }} onClick={() => nav.go('plotEdit', { id: p.id })}>
              <div><div className="plot-n">{p.name}</div><div className="muted">{p.area} 亩 · {hasLoc ? (p.address || '已定位') : '未定位（无法自动获取天气）'}</div></div>
              <div className="muted">编辑 ›</div>
            </div>
            {cb ? (
              <div className="cur" onClick={() => nav.go('season', { id: cb.id })}>
                <div className={'crop ' + cb.crop.cls} style={{ width: 36, height: 36, fontSize: 17 }}>{cb.crop.short}</div>
                <div className="f1" style={{ marginLeft: 10 }}>
                  <div style={{ fontWeight: 700 }}>{cb.label} {cb.crop.name}<span className="tag">在种 · 第{cb.dayN}天</span></div>
                  <div className="muted">投入 ¥{U.money(cb.cost)} · 积温 {cb.gdd} · 降雨 {cb.rain}mm</div>
                </div>
                <div className="muted" style={{ fontSize: 22 }}>›</div>
              </div>
            ) : <div className="btn ghost" style={{ marginTop: 12 }} onClick={() => nav.go('seasonNew', { plotId: p.id })}>＋ 在这块地开始新一季</div>}
            {ss.some(s => s.status === 'done') && (
              <div className="his">
                <div className="muted" style={{ marginBottom: 4 }}>往季记录</div>
                {ss.filter(s => s.status === 'done').map(s => { const b = GY.brief(s); return (
                  <div className="r" key={s.id} onClick={() => nav.go('season', { id: s.id })}>
                    <b>{b.label} {b.crop.name}</b><span className="muted"> ¥{U.money(b.cost)} · 积温{b.gdd}{s.yieldJin ? ' · 产量' + U.money(s.yieldJin) + '斤' : ''}</span>
                  </div>); })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MinePage({ ui }) {
  useDB();
  const d = S.db; const y = String(new Date().getFullYear());
  const yc = d.costs.filter(c => c.date.slice(0, 4) === y).reduce((a, c) => a + c.amount, 0);
  const exportText = () => {
    const lines = ['【谷雨记 · 数据导出】' + U.today()];
    S.seasons.all().forEach(s => { const b = GY.brief(s); const cs = GY.costSummary(s.id);
      lines.push('', '■ ' + b.plot.name + ' ' + b.label + b.crop.name + '（' + (s.status === 'done' ? '已收获' : '在种') + '）');
      lines.push('积温 ' + b.gdd + '℃·天 · 降雨 ' + b.rain + 'mm');
      cs.cats.forEach(c => { if (c.total) lines.push('  ' + c.name + '：¥' + U.money(c.total)); });
      lines.push('  合计：¥' + U.money(cs.total)); });
    navigator.clipboard && navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
    ui.toast('已复制，可粘贴到微信');
  };
  return (
    <div className="page wrap">
      <div className="card row">
        <div className="me-av">谷</div>
        <div className="f1" style={{ marginLeft: 12 }}>
          <div style={{ fontSize: 20, fontWeight: 800 }}>我的农田账本</div>
          <div className="muted">{y} 年已投入 <b className="num" style={{ color: 'var(--ink)' }}>¥{U.money(yc)}</b></div>
        </div>
      </div>
      <div className="card counts">
        {[[d.plots.length, '地块'], [d.seasons.length, '种植季'], [d.costs.length, '笔账'], [d.logs.length, '条记事']].map(([n, l]) => <div key={l}><div className="num n">{n}</div><div className="muted">{l}</div></div>)}
      </div>
      <div className="card" style={{ padding: '0 16px' }}>
        <div className="mitem" onClick={() => ui.toast('原型中数据存于浏览器本地')}><div className="f1"><div>数据备份</div><div className="muted" style={{ fontSize: 13 }}>本地模式 · 数据存在这部手机里</div></div></div>
        <div className="mitem" onClick={exportText}><div className="f1">导出为文字（复制到微信）</div><span className="muted">›</span></div>
        <div className="mitem" onClick={() => ui.toast('调起微信分享')}><div className="f1">推荐给种地的朋友</div><span className="muted">›</span></div>
        <div className="mitem" onClick={() => ui.modal({ title: '关于谷雨记', content: '谷雨种谷，雨生百谷。\n记下作物生长的每一场雨、每一天。\n天气数据来自 Open-Meteo 开源天气。' })}><div className="f1">关于谷雨记</div><span className="muted">›</span></div>
      </div>
    </div>
  );
}

// 荣成附近几个预设点，模拟 wx.chooseLocation
const DEMO_LOCS = [
  { name: '荣成市 · 崖头', lat: 37.165, lng: 122.486 },
  { name: '荣成市 · 石岛', lat: 36.883, lng: 122.42 },
  { name: '文登区 · 城区', lat: 37.194, lng: 122.058 },
  { name: '莱阳市 · 城区', lat: 36.978, lng: 120.711 }
];

function PlotEditPage({ nav, ui, params }) {
  const orig = params.id ? S.plots.get(params.id) : null;
  const [f, setF] = useState(orig ? { ...orig, area: String(orig.area) } : { name: '', area: '', lat: '', lng: '', address: '' });
  const [pick, setPick] = useState(false);
  const up = (k, v) => setF(x => ({ ...x, [k]: v }));
  const useCurrent = () => {
    if (!navigator.geolocation) return ui.toast('没拿到位置');
    navigator.geolocation.getCurrentPosition(
      p => setF(x => ({ ...x, lat: Math.round(p.coords.latitude * 1000) / 1000, lng: Math.round(p.coords.longitude * 1000) / 1000, address: '当前位置' })),
      () => ui.toast('没拿到位置，请允许定位'), { timeout: 8000 });
  };
  const save = () => {
    if (!f.name.trim()) return ui.toast('请填写地块名称');
    const area = parseFloat(f.area); if (!(area > 0)) return ui.toast('请填写亩数');
    S.plots.save({ id: f.id, name: f.name.trim(), area, lat: f.lat, lng: f.lng, address: f.address });
    ui.toast('已保存'); setTimeout(nav.back, 400);
  };
  const del = () => ui.modal({ title: '删除地块', content: '该地块下所有种植季、账目、记事都会一起删除，且不能恢复。', confirm: '删除', danger: true, onOk: () => { S.plots.remove(f.id); nav.back(); } });
  const has = f.lat !== '' && f.lat != null;
  return (
    <div className="page">
      <div className="wrap">
        <div className="card">
          <div className="field"><div className="label">地块名称<span className="req">*</span></div><input className="input" placeholder="如：村东大块、河边地" value={f.name} onChange={e => up('name', e.target.value)} maxLength={20} /></div>
          <div className="field"><div className="label">面积<span className="req">*</span></div><div className="iu"><input className="input num" inputMode="decimal" placeholder="0" value={f.area} onChange={e => up('area', e.target.value)} /><span className="unit">亩</span></div></div>
          <div className="field" style={{ marginBottom: 0 }}>
            <div className="label">地块位置 <span className="muted hint">· 用来自动获取每天的气温和降雨</span></div>
            <div className="loc" onClick={() => setPick(true)}>
              <div className="f1">{has ? <><div style={{ fontWeight: 700 }}>{f.address}</div><div className="muted num">北纬 {f.lat}° · 东经 {f.lng}°</div></> : <span style={{ color: '#A8A596' }}>点这里在地图上选位置</span>}</div>
              <span className="muted" style={{ fontSize: 22 }}>›</span>
            </div>
            <div className="btn ghost small" style={{ marginTop: 10 }} onClick={useCurrent}>我就在地头，用当前位置</div>
          </div>
        </div>
        {orig && <div className="btn danger" onClick={del}>删除这块地</div>}
      </div>
      <div className="fixed"><div className="btn" onClick={save}>保存</div></div>
      {pick && <div className="mask" onClick={() => setPick(false)}><div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-t">选择地块位置</div>
        <div className="map"><div className="pin"></div>地图选点（小程序内为 wx.chooseLocation）</div>
        <div className="chips" style={{ marginTop: 14 }}>
          {DEMO_LOCS.map(l => <div key={l.name} className={'chip' + (f.address === l.name ? ' on' : '')} onClick={() => { setF(x => ({ ...x, lat: l.lat, lng: l.lng, address: l.name })); setPick(false); }}>{l.name}</div>)}
        </div>
      </div></div>}
    </div>
  );
}

function SeasonNewPage({ nav, ui, params }) {
  const plots = S.plots.all();
  const busy = {}; plots.forEach(p => { if (S.seasons.current(p.id)) busy[p.id] = true; });
  const free = plots.find(p => !busy[p.id]);
  const m = new Date().getMonth() + 1;
  const [f, setF] = useState({ plotId: params.plotId || (free ? free.id : (plots[0] && plots[0].id)), crop: m >= 5 && m <= 7 ? 'corn' : 'wheat', sowDate: U.today(), seedRate: '', tillage: '' });
  const up = (k, v) => setF(x => ({ ...x, [k]: v }));
  const addTill = w => up('tillage', f.tillage ? (f.tillage.includes(w) ? f.tillage : f.tillage + '、' + w) : w);
  const save = () => {
    if (!f.plotId) return ui.toast('请先添加地块');
    if (busy[f.plotId]) return ui.modal({ title: '这块地还有一季没收', content: '请先在那一季里登记收获，再开新一季。' });
    const s = S.seasons.save({ plotId: f.plotId, crop: f.crop, sowDate: f.sowDate, seedRate: f.seedRate ? parseFloat(f.seedRate) : '', tillage: f.tillage.trim(), status: 'growing' });
    GY.fillSeason(s).catch(() => null);
    ui.toast('开季成功'); setTimeout(() => nav.redirect('season', { id: s.id }), 400);
  };
  return (
    <div className="page">
      <div className="wrap">
        <div className="card">
          <div className="field"><div className="label">种在哪块地<span className="req">*</span></div>
            <div className="chips">{plots.map(p => <div key={p.id} className={'chip' + (f.plotId === p.id ? ' on' : '')} onClick={() => up('plotId', p.id)}>{p.name}{busy[p.id] ? '（在种）' : ''}</div>)}</div>
            {!plots.length && <div className="btn ghost small" onClick={() => nav.redirect('plotEdit')}>先添加地块</div>}
          </div>
          <div className="field"><div className="label">种什么<span className="req">*</span></div>
            <div className="tiles">{GY.CROPS.map(c => <div key={c.key} className={'tile' + (f.crop === c.key ? ' on' : '') + (c.enabled ? '' : ' dis')} onClick={() => c.enabled ? up('crop', c.key) : ui.toast(c.name + '后续开放')}>
              <div className={'crop ' + c.cls} style={{ width: 30, height: 30, fontSize: 15 }}>{c.short}</div>{c.name}</div>)}</div>
          </div>
          <div className="field"><div className="label">播种日期<span className="req">*</span> <span className="muted hint">· 这一季从这天算起</span></div><input className="input num" type="date" max={U.today()} value={f.sowDate} onChange={e => up('sowDate', e.target.value)} /></div>
          <div className="field"><div className="label">播种量</div><div className="iu"><input className="input num" inputMode="decimal" placeholder="0" value={f.seedRate} onChange={e => up('seedRate', e.target.value)} /><span className="unit">斤/亩</span></div></div>
          <div className="field" style={{ marginBottom: 0 }}><div className="label">整地情况</div>
            <div className="chips" style={{ marginBottom: 8 }}>{['旋耕', '深翻', '深松', '免耕', '秸秆还田'].map(w => <div key={w} className="chip" onClick={() => addTill(w)}>+ {w}</div>)}</div>
            <textarea className="input" placeholder="如：玉米秸秆还田后旋耕两遍" value={f.tillage} onChange={e => up('tillage', e.target.value)} />
          </div>
        </div>
      </div>
      <div className="fixed"><div className="btn" onClick={save}>开始这一季</div></div>
    </div>
  );
}

Object.assign(window, { useDB, HomePage, PlotsPage, MinePage, PlotEditPage, SeasonNewPage });
