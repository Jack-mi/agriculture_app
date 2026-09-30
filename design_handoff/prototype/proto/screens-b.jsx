/* 谷雨记 原型 · 页面 B：季详情 / 记账 / 记事 / 收获 */
const { U: GU, S: GS } = window.GY;

function SeasonPage({ nav, ui, params }) {
  useDB();
  const [tab, setTab] = React.useState(params.tab || 'cost');
  const [openCat, setOpenCat] = React.useState('');
  const [wxState, setWx] = React.useState({ loading: false, msg: '' });
  const [edit, setEdit] = React.useState(null);
  const s = GS.seasons.get(params.id);
  const load = force => {
    const cur = GS.seasons.get(params.id); if (!cur) return;
    setWx({ loading: true, msg: '' });
    GY.fillSeason(cur, force).then(r => setWx({ loading: false, msg: !r.ok ? (r.reason === 'nolocation' ? '地块未定位，无法自动获取天气' : '网络不好，天气稍后自动补齐') : '' })).catch(() => setWx({ loading: false, msg: '' }));
  };
  React.useEffect(() => { load(); }, [params.id]);
  if (!s) return <div className="empty">这一季已删除</div>;
  const plot = GS.plots.get(s.plotId) || {};
  const b = GY.brief(s); const cs = GY.costSummary(s.id); const ws = GY.weatherSeries(s);
  const costs = GS.costs.bySeason(s.id);
  const groups = {}; GS.logs.bySeason(s.id).forEach(l => (groups[l.date] = groups[l.date] || []).push(l));
  const last = ws.rows.slice(-30); const maxP = Math.max(5, ...last.map(r => r.p || 0));
  const done = s.status === 'done';
  const perMuYield = s.yieldJin && plot.area ? Math.round(s.yieldJin / plot.area) : 0;

  const saveEdit = () => {
    const t = parseFloat(edit.t), p = parseFloat(edit.p);
    if (isNaN(t)) return ui.toast('请填写平均气温');
    GS.weather.setManual(s.plotId, edit.date, t, isNaN(p) ? 0 : p); setEdit(null); ui.toast('已修正');
  };

  return (
    <div className="page" style={{ paddingBottom: 90 }}>
      <div className="top">
        <div className="row">
          <div className={'crop ' + b.crop.cls}>{b.crop.short}</div>
          <div className="f1" style={{ marginLeft: 12 }}>
            <div className="tn">{b.label} {b.crop.name}<span className={'tag' + (done ? ' done' : '')}>{done ? '已收获' : '在种'}</span></div>
            <div className="ts">{plot.name} · {plot.area} 亩 · {done ? '全周期' : '第'} {b.dayN} 天</div>
          </div>
        </div>
        <div className="kpis">
          <div className="kpi"><div className="k">总投入</div><div className="v num">¥{GU.money(cs.total)}</div><div className="s">{b.perMu ? '¥' + GU.money(Math.round(b.perMu)) + '/亩' : ' '}</div></div>
          <div className="kpi"><div className="k">累计积温</div><div className="v num">{ws.gdd}</div><div className="s">℃·天</div></div>
          <div className="kpi"><div className="k">累计降雨</div><div className="v num">{ws.rain}</div><div className="s">毫米</div></div>
        </div>
      </div>
      <div className="tabs">{[['cost', '账本'], ['log', '记事'], ['wx', '天气'], ['info', '信息']].map(([k, l]) => <div key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</div>)}</div>
      <div className="wrap" style={{ paddingBottom: 20 }}>
        {tab === 'cost' && <>
          <div className="card" style={{ padding: '6px 16px' }}>
            {cs.total > 0 && <div className="stack">{cs.cats.filter(c => c.total).map(c => <div key={c.key} style={{ width: c.pct + '%', background: c.color }} />)}</div>}
            {cs.cats.map(c => (
              <div className="catr" key={c.key} onClick={() => setOpenCat(openCat === c.key ? '' : c.key)}>
                <div className="row"><div className="catd" style={{ background: c.color }} /><div className="f1 catn">{c.name}{c.count > 0 && <span className="muted"> · {c.count}笔</span>}</div><div className="num cata">¥{GU.money(c.total)}</div><div className="muted pct num">{c.pct}%</div></div>
                {openCat === c.key && Object.keys(c.subs).length > 0 && <div className="subs">{Object.keys(c.subs).map(k => <div className="row between" key={k}><span>{k}</span><span className="num">¥{GU.money(c.subs[k])}</span></div>)}</div>}
              </div>))}
            <div className="row between" style={{ padding: '13px 0 10px' }}><b>本季合计</b><b className="num" style={{ fontSize: 22 }}>¥{GU.money(cs.total)}</b></div>
          </div>
          <div className="sec">流水（{costs.length}）</div>
          {!costs.length ? <div className="card empty"><div className="muted">还没有记账，点下面「记一笔账」</div></div> :
            <div className="card" style={{ padding: '0 16px' }}>{costs.map(c => { const cat = GY.catOf(c.cat); return (
              <div className="flow" key={c.id} onClick={() => nav.go('costEdit', { id: c.id })}>
                <div className="flow-d num">{GU.cn(c.date)}</div>
                <div className="f1"><div><span className="pill" style={{ color: cat.color, borderColor: cat.color }}>{cat.name}</span>{c.sub}{c.people ? <span className="muted"> · {c.people}人</span> : null}</div>{c.note && <div className="muted ell">{c.note}</div>}</div>
                <div className="num flow-a">¥{GU.money(c.amount)}</div>
              </div>); })}</div>}
        </>}

        {tab === 'log' && <>
          {!Object.keys(groups).length && <div className="card empty"><div className="muted">还没有记事，每天干了什么活随手记下来</div></div>}
          {Object.keys(groups).sort().reverse().map(d => { const w = GS.weather.get(s.plotId, d); return (
            <div key={d} style={{ marginBottom: 6 }}>
              <div className="dayh"><b>{GU.cn(d)}</b><span className="muted">{GU.week(d)} · 第{GU.diffDays(s.sowDate, d) + 1}天</span>{w && <span className="w">{w.t}℃ · {w.p}mm</span>}</div>
              {groups[d].map(l => { const lc = GS.db.costs.filter(c => c.logId === l.id).reduce((a, c) => a + c.amount, 0); return (
                <div className="card log" key={l.id} onClick={() => nav.go('logEdit', { id: l.id })}>
                  {l.ops && l.ops.length > 0 && <div className="o">{l.ops.join(' · ')}</div>}
                  {l.text && <div className="x">{l.text}</div>}
                  {l.fertName && <div className="m">施肥：{l.fertName}{l.fertRate ? ' ' + l.fertRate + ' 斤/亩' : ''}</div>}
                  {l.moisture && <div className="m">墒情：{l.moisture}</div>}
                  {lc > 0 && <div className="m" style={{ color: 'var(--wheat)', fontWeight: 600 }}>关联花费 ¥{GU.money(lc)}</div>}
                </div>); })}
            </div>); })}
        </>}

        {tab === 'wx' && <>
          <div className="card">
            <div className="row between">
              <div><div className="muted">全周期积温（逐日均温累计）</div><div className="num bigv heat">{ws.gdd}<small>℃·天</small></div></div>
              <div style={{ textAlign: 'right' }}><div className="muted">全周期降雨</div><div className="num bigv rain">{ws.rain}<small>mm</small></div></div>
            </div>
            <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>共 {ws.days} 天，已获取 {ws.known} 天{ws.manual ? '（手工修正 ' + ws.manual + ' 天）' : ''}{ws.missing ? '，缺 ' + ws.missing + ' 天' : ''}</div>
            {last.length > 0 && <><div className="bars">{last.map(r => <div key={r.date} title={r.date + ' ' + (r.p || 0) + 'mm'} style={{ height: r.p ? Math.max(4, r.p / maxP * 100) + '%' : 0 }} />)}</div>
              <div className="row between muted" style={{ fontSize: 11 }}><span>{last[0].date.slice(5)}</span><span>近30天降雨</span><span>{last[last.length - 1].date.slice(5)}</span></div></>}
            {wxState.msg && <div className="warnb">{wxState.msg}{(plot.lat === '' || plot.lat == null) && <b style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => nav.go('plotEdit', { id: plot.id })}> 去定位 ›</b>}</div>}
            <div className="btn ghost small" style={{ marginTop: 10 }} onClick={() => load(true)}>{wxState.loading ? '获取中…' : '重新获取天气'}</div>
          </div>
          <div className="sec">逐日记录 · 点某天可手工修正</div>
          <div className="card" style={{ padding: 0 }}>
            <div className="wxh"><span className="c1">日期</span><span className="c2">均温℃</span><span className="c3">降雨mm</span><span className="c4">积温</span><span className="c5">累计雨</span></div>
            {ws.rows.slice().reverse().map(r => (
              <div className="wxl" key={r.date} onClick={() => setEdit({ date: r.date, t: r.has ? String(r.t) : '', p: r.has ? String(r.p) : '', src: r.src })}>
                <div className="c1">{GU.cn(r.date)}{r.src === 'manual' && <span className="tag warn" style={{ fontSize: 10, marginLeft: 3 }}>改</span>}</div>
                <span className="c2 num heat">{r.has ? r.t : '—'}</span><span className="c3 num rain">{r.has ? r.p : '—'}</span><span className="c4 num">{r.gdd}</span><span className="c5 num">{r.rain}</span>
              </div>))}
          </div>
          <div className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 6 }}>数据来源：Open-Meteo 开源天气</div>
        </>}

        {tab === 'info' && <>
          <div className="card">
            <div className="kv"><span className="muted">播种时间</span><span>{GU.cn(s.sowDate, true)}</span></div>
            <div className="kv"><span className="muted">播种量</span><span>{s.seedRate ? s.seedRate + ' 斤/亩' : '未填'}</span></div>
            <div className="kv col"><span className="muted">整地情况</span><span>{s.tillage || '未填'}</span></div>
          </div>
          {done && <div className="card">
            <div className="kv"><span className="muted">收获时间</span><span>{GU.cn(s.harvestDate, true)}</span></div>
            <div className="kv"><span className="muted">总产量</span><span>{GU.money(s.yieldJin)} 斤</span></div>
            {perMuYield > 0 && <div className="kv"><span className="muted">亩产</span><span>{GU.money(perMuYield)} 斤/亩</span></div>}
            {cs.total > 0 && <div className="kv"><span className="muted">每斤成本</span><span>{(cs.total / s.yieldJin).toFixed(2)} 元/斤</span></div>}
            <div className="kv"><span className="muted">全周期积温</span><span>{ws.gdd} ℃·天</span></div>
            <div className="kv"><span className="muted">全周期降雨</span><span>{ws.rain} mm</span></div>
            {s.harvestNote && <div className="kv"><span className="muted">备注</span><span>{s.harvestNote}</span></div>}
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <div className="btn ghost small" onClick={() => nav.go('harvest', { id: s.id })}>修改收获信息</div>
              <div className="btn ghost small" onClick={() => ui.modal({ title: '撤销收获', content: '恢复为"在种"状态？', onOk: () => { if (GS.seasons.current(s.plotId)) return ui.toast('这块地已有在种的季'); GS.seasons.save({ id: s.id, status: 'growing', harvestDate: '' }); } })}>撤销收获</div>
            </div>
          </div>}
          <div className="btn danger" onClick={() => ui.modal({ title: '删除这一季', content: '这一季的所有账目和记事都会删除，不能恢复。', confirm: '删除', danger: true, onOk: () => { GS.seasons.remove(s.id); nav.back(); } })}>删除这一季</div>
        </>}
      </div>

      <div className="fixed">
        {!done ? <>
          <div className="btn wheat" onClick={() => nav.go('costEdit', { seasonId: s.id })}>记一笔账</div>
          <div className="btn" onClick={() => nav.go('logEdit', { seasonId: s.id })}>记今天的活</div>
          <div className="btn ghost" style={{ flex: '0 0 76px' }} onClick={() => nav.go('harvest', { id: s.id })}>收获</div>
        </> : <>
          <div className="btn wheat" onClick={() => nav.go('costEdit', { seasonId: s.id })}>补记一笔账</div>
          <div className="btn ghost" onClick={() => nav.go('logEdit', { seasonId: s.id })}>补记事</div>
        </>}
      </div>

      {edit && <div className="mask" onClick={() => setEdit(null)}><div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-t">修正 {GU.cn(edit.date, true)} 天气</div>
        <div className="row" style={{ gap: 10 }}>
          <div className="field f1"><div className="label">平均气温</div><div className="iu"><input className="input num" inputMode="decimal" value={edit.t} onChange={e => setEdit({ ...edit, t: e.target.value })} /><span className="unit">℃</span></div></div>
          <div className="field f1"><div className="label">降雨量</div><div className="iu"><input className="input num" inputMode="decimal" value={edit.p} onChange={e => setEdit({ ...edit, p: e.target.value })} /><span className="unit">mm</span></div></div>
        </div>
        <div className="muted" style={{ fontSize: 13, margin: '-6px 0 12px' }}>零下气温可直接输入负号，如 -3.5</div>
        <div className="row" style={{ gap: 10 }}>
          {edit.src === 'manual' && <div className="btn ghost f1" onClick={() => { GS.weather.reset(s.plotId, edit.date); setEdit(null); load(); }}>恢复自动</div>}
          <div className="btn" style={{ flex: 2 }} onClick={saveEdit}>保存</div>
        </div>
      </div></div>}
    </div>
  );
}

function CostEditPage({ nav, ui, params }) {
  const orig = params.id ? GS.costs.get(params.id) : null;
  const sid = orig ? orig.seasonId : params.seasonId;
  const s = GS.seasons.get(sid); const plot = s && GS.plots.get(s.plotId);
  const init = orig ? { ...orig, amount: String(orig.amount), people: orig.people ? String(orig.people) : '', unitPrice: orig.unitPrice ? String(orig.unitPrice) : '' }
    : { seasonId: sid, logId: params.logId || '', cat: params.cat || 'agri', sub: params.sub || GY.catOf(params.cat || 'agri').subs[0], date: params.date || GU.today(), amount: '', people: '', unitPrice: '', note: params.note || '' };
  const [f, setF] = React.useState(init);
  const up = (k, v) => setF(x => {
    const n = { ...x, [k]: v };
    if ((k === 'people' || k === 'unitPrice') && parseFloat(n.people) > 0 && parseFloat(n.unitPrice) > 0) n.amount = String(Math.round(parseFloat(n.people) * parseFloat(n.unitPrice) * 100) / 100);
    return n;
  });
  const cat = GY.catOf(f.cat);
  const save = again => {
    const amount = parseFloat(f.amount); if (!(amount > 0)) return ui.toast('请填写金额');
    GS.costs.save({ id: f.id, seasonId: f.seasonId, logId: f.logId, date: f.date, cat: f.cat, sub: f.sub, amount, people: f.cat === 'labor' && f.people ? parseFloat(f.people) : '', unitPrice: f.cat === 'labor' && f.unitPrice ? parseFloat(f.unitPrice) : '', note: f.note.trim() });
    ui.toast('记好了');
    if (again) setF(x => ({ ...x, amount: '', note: '', people: '', unitPrice: '' })); else setTimeout(nav.back, 350);
  };
  return (
    <div className="page">
      <div className="wrap">
        <div className="muted" style={{ margin: '0 4px 8px' }}>{plot && plot.name + ' · ' + GY.cropOf(s.crop).name}{f.logId ? ' · 关联记事' : ''}</div>
        <div className="card">
          <div className="label">花在哪一类</div>
          <div className="tiles">{GY.COST_CATS.map(c => <div key={c.key} className={'tile' + (f.cat === c.key ? ' on' : '')} onClick={() => setF(x => ({ ...x, cat: c.key, sub: c.subs[0] }))}><div className="dot" style={{ background: c.color }} />{c.name}</div>)}</div>
          <div className="chips" style={{ marginTop: 12 }}>{cat.subs.map(x => <div key={x} className={'chip' + (f.sub === x ? ' on' : '')} onClick={() => up('sub', x)}>{x}</div>)}</div>
        </div>
        <div className="card">
          {f.cat === 'labor' && <div className="row" style={{ gap: 10 }}>
            <div className="field f1"><div className="label">雇了几个人</div><div className="iu"><input className="input num" inputMode="decimal" placeholder="0" value={f.people} onChange={e => up('people', e.target.value)} /><span className="unit">人</span></div></div>
            <div className="field f1"><div className="label">每人每天</div><div className="iu"><input className="input num" inputMode="decimal" placeholder="0" value={f.unitPrice} onChange={e => up('unitPrice', e.target.value)} /><span className="unit">元</span></div></div>
          </div>}
          <div className="field"><div className="label">金额<span className="req">*</span></div><div className="amt"><span>¥</span><input inputMode="decimal" placeholder="0" value={f.amount} onChange={e => up('amount', e.target.value)} autoFocus={!orig && f.cat !== 'labor'} /></div></div>
          <div className="field"><div className="label">日期</div><input className="input num" type="date" max={GU.today()} value={f.date} onChange={e => up('date', e.target.value)} /></div>
          <div className="field" style={{ marginBottom: 0 }}><div className="label">备注</div><input className="input" placeholder={f.cat === 'agri' ? '如：复合肥 20 袋' : f.cat === 'mach' ? '如：老王家的收割机' : '选填'} value={f.note} onChange={e => up('note', e.target.value)} maxLength={60} /></div>
        </div>
        {orig && <div className="btn danger" onClick={() => ui.modal({ title: '删除这笔账', confirm: '删除', danger: true, onOk: () => { GS.costs.remove(orig.id); nav.back(); } })}>删除这笔账</div>}
      </div>
      <div className="fixed">
        {!orig && <div className="btn ghost" onClick={() => save(true)}>保存，再记一笔</div>}
        <div className="btn wheat" onClick={() => save(false)}>保存</div>
      </div>
    </div>
  );
}

function LogEditPage({ nav, ui, params }) {
  const orig = params.id ? GS.logs.get(params.id) : null;
  const sid = orig ? orig.seasonId : params.seasonId;
  const s = GS.seasons.get(sid); const plot = s && GS.plots.get(s.plotId);
  const [f, setF] = React.useState(orig ? { ...orig, fertRate: orig.fertRate ? String(orig.fertRate) : '', fertName: orig.fertName || '', moisture: orig.moisture || '', text: orig.text || '' }
    : { seasonId: sid, date: GU.today(), ops: [], text: '', fertName: '', fertRate: '', moisture: '' });
  const up = (k, v) => setF(x => ({ ...x, [k]: v }));
  const toggle = o => up('ops', f.ops.includes(o) ? f.ops.filter(x => x !== o) : [...f.ops, o]);
  const w = plot && GS.weather.get(plot.id, f.date);
  const today = GU.today();
  const collect = () => {
    const ops = GY.OPS.filter(o => f.ops.includes(o));
    if (!ops.length && !f.text.trim() && !f.moisture.trim()) { ui.toast('选一项活，或写几句'); return null; }
    return { id: f.id, seasonId: f.seasonId, date: f.date, ops, text: f.text.trim(), fertName: ops.includes('施肥') ? f.fertName.trim() : '', fertRate: ops.includes('施肥') && f.fertRate ? parseFloat(f.fertRate) : '', moisture: f.moisture.trim() };
  };
  const save = () => { const l = collect(); if (!l) return; GS.logs.save(l); ui.toast('记好了'); setTimeout(nav.back, 350); };
  const saveWithCost = () => {
    const l = collect(); if (!l) return; const saved = GS.logs.save(l);
    const first = l.ops.find(o => GY.OP_TO_COST[o]); const m = first ? GY.OP_TO_COST[first] : ['agri', '其他'];
    nav.redirect('costEdit', { seasonId: l.seasonId, logId: saved.id, date: l.date, cat: m[0], sub: m[1], note: [l.ops.join('、'), l.fertName].filter(Boolean).join(' · ') });
  };
  const linked = orig ? GS.db.costs.filter(c => c.logId === orig.id).reduce((a, c) => a + c.amount, 0) : 0;
  return (
    <div className="page">
      <div className="wrap">
        <div className="row between" style={{ margin: '0 4px 8px' }}>
          <span className="muted">{plot && plot.name + ' · ' + GY.cropOf(s.crop).name}</span>
          <label className="datep num">{f.date === today ? '今天' : f.date} ▾<input type="date" max={today} value={f.date} onChange={e => e.target.value && up('date', e.target.value)} /></label>
        </div>
        {w && <div className="wxs">当天天气：均温 <b className="num heat">{w.t}℃</b> · 降雨 <b className="num rain">{w.p}mm</b> <span className="muted" style={{ fontSize: 12 }}>（{w.src === 'manual' ? '手工修正' : '自动获取'}）</span></div>}
        <div className="card">
          <div className="label">今天干了什么活（可多选）</div>
          <div className="tiles">{GY.OPS.map(o => <div key={o} className={'tile' + (f.ops.includes(o) ? ' on' : '')} onClick={() => toggle(o)} style={{ height: 54, fontSize: 17 }}>{f.ops.includes(o) ? '✓ ' : ''}{o}</div>)}</div>
          {f.ops.includes('施肥') && <div className="fert">
            <div className="label">施肥明细</div>
            <div className="row" style={{ gap: 10 }}>
              <input className="input f1" placeholder="肥料品类，如尿素" value={f.fertName} onChange={e => up('fertName', e.target.value)} />
              <div className="iu" style={{ width: 140 }}><input className="input num" inputMode="decimal" placeholder="用量" value={f.fertRate} onChange={e => up('fertRate', e.target.value)} /><span className="unit">斤/亩</span></div>
            </div>
          </div>}
          <div className="field" style={{ margin: '16px 0 0' }}>
            <div className="label">具体情况 <span className="muted hint">· 用了什么机械、谁家的机械也写这里</span></div>
            <textarea className="input" placeholder="如：雇老张家无人机飞防，打了一遍吡虫啉" value={f.text} onChange={e => up('text', e.target.value)} maxLength={500} />
          </div>
        </div>
        <div className="card">
          <div className="label">土壤墒情 <span className="muted hint">· 有观察就记</span></div>
          <div className="chips" style={{ marginBottom: 8 }}>{GY.MOISTURE.map(m => <div key={m} className={'chip' + (f.moisture === m ? ' on' : '')} onClick={() => up('moisture', m)}>{m}</div>)}</div>
          <input className="input" placeholder="或自己写，如：表层干，10公分下湿润" value={f.moisture} onChange={e => up('moisture', e.target.value)} maxLength={80} />
        </div>
        {linked > 0 && <div className="muted" style={{ textAlign: 'center', marginBottom: 10 }}>这条记事已关联 ¥{GU.money(linked)} 花费</div>}
        {orig && <div className="btn danger" onClick={() => ui.modal({ title: '删除这条记事', content: '关联的账目会保留。', confirm: '删除', danger: true, onOk: () => { GS.logs.remove(orig.id); nav.back(); } })}>删除这条记事</div>}
      </div>
      <div className="fixed">
        <div className="btn wheat" onClick={saveWithCost}>保存并记花费</div>
        <div className="btn" onClick={save}>保存</div>
      </div>
    </div>
  );
}

function HarvestPage({ nav, ui, params }) {
  const s = GS.seasons.get(params.id); const plot = GS.plots.get(s.plotId) || {};
  const [f, setF] = React.useState({ date: s.harvestDate || GU.today(), yieldJin: s.yieldJin ? String(s.yieldJin) : '', note: s.harvestNote || '' });
  const sim = { ...s, status: 'done', harvestDate: f.date };
  const ws = GY.weatherSeries(sim); const cs = GY.costSummary(s.id); const y = parseFloat(f.yieldJin);
  const days = GU.diffDays(s.sowDate, f.date) + 1;
  const save = () => {
    if (!(y > 0)) return ui.toast('请填写产量');
    GS.seasons.save({ id: s.id, status: 'done', harvestDate: f.date, yieldJin: y, harvestNote: f.note.trim() });
    ui.modal({ title: '这一季收官了', content: '共 ' + days + ' 天\n积温 ' + ws.gdd + '℃·天 · 降雨 ' + ws.rain + 'mm\n总投入 ¥' + GU.money(cs.total), confirm: '好的', single: true, onOk: nav.back });
  };
  return (
    <div className="page">
      <div className="wrap">
        <div className="card">
          <div className="field"><div className="label">收获日期<span className="req">*</span></div><input className="input num" type="date" min={s.sowDate} max={GU.today()} value={f.date} onChange={e => e.target.value && setF({ ...f, date: e.target.value })} /></div>
          <div className="field"><div className="label">总产量<span className="req">*</span></div><div className="iu"><input className="input num" inputMode="decimal" placeholder="0" value={f.yieldJin} onChange={e => setF({ ...f, yieldJin: e.target.value })} /><span className="unit">斤</span></div>
            {y > 0 && plot.area > 0 && <div className="muted" style={{ marginTop: 5 }}>折合亩产 <b className="num" style={{ color: 'var(--ink)' }}>{Math.round(y / plot.area)}</b> 斤/亩</div>}</div>
          <div className="field" style={{ marginBottom: 0 }}><div className="label">备注</div><input className="input" placeholder="如：卖给粮站，1.2元/斤" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></div>
        </div>
        <div className="sec">全周期汇总</div>
        <div className="card sum">
          <div><div className="muted">生长天数</div><div className="num v">{days}<small>天</small></div></div>
          <div><div className="muted">积温总和</div><div className="num v heat">{ws.gdd}<small>℃·天</small></div></div>
          <div><div className="muted">降雨总量</div><div className="num v rain">{ws.rain}<small>mm</small></div></div>
          <div><div className="muted">总投入</div><div className="num v">¥{GU.money(cs.total)}</div></div>
          {y > 0 && cs.total > 0 && <div className="full"><div className="muted">每斤粮成本</div><div className="num v" style={{ color: 'var(--wheat)' }}>{(cs.total / y).toFixed(2)}<small>元/斤</small></div></div>}
        </div>
        {ws.missing > 0 && <div className="muted" style={{ fontSize: 13, margin: '0 4px' }}>有 {ws.missing} 天天气未获取，可在「天气」页补齐或手工修正</div>}
      </div>
      <div className="fixed"><div className="btn wheat" onClick={save}>确认收获，结束本季</div></div>
    </div>
  );
}

Object.assign(window, { SeasonPage, CostEditPage, LogEditPage, HarvestPage });
