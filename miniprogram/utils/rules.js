// 农事参谋 · 任务规则表（作物 × 生育期 × 天气 × 农户记录）
// 规则决定"该不该干"；AI 只负责把任务写成人话和在对话里调整
// 每条规则：{ key, crop, source, test(ctx) → null | { title, due:[start,end], why[], steps[], ref, ops[], matType, target, level } }
// ctx: { season, plot, st(当前生育期), fc(预报), alerts, logs, today, U, lastLogOf(ops) }

function dueAround(U, date, before, after) { return [U.addDays(date, -before), U.addDays(date, after)]; }
function stageIs(ctx, keys) { return keys.indexOf(ctx.st.stage.key) >= 0; }
function nextIs(ctx, key) { return ctx.st.next && ctx.st.next.key === key; }
function doneOp(ctx, ops, since) {
  return ctx.logs.some(l => l.date >= (since || ctx.season.sowDate) && (l.ops || []).some(o => ops.indexOf(o) >= 0));
}
function alertOf(ctx, type) { return ctx.alerts.find(a => a.type === type); }

const RULES = [
  // ---------------- 小麦 ----------------
  {
    key: 'wheat.checkSeedling', crop: 'wheat', source: 'stage',
    test(ctx) {
      if (!stageIs(ctx, ['emerge', 'leaf3'])) return null;
      if (doneOp(ctx, ['巡田', '补种', '查苗'])) return null;
      const d = ctx.U.today();
      return { title: '查苗，缺苗断垄及时补种', due: [d, ctx.U.addDays(d, 6)], ref: 'wheatSowing', ops: ['巡田'], level: 'week',
        why: ['已到' + ctx.st.stage.name + '（有效积温 ' + ctx.st.gdd + '）', '补种越早，冬前越能长成壮苗'],
        steps: ['逐垄查看出苗情况', '断垄 10 公分以上的用同品种催芽补种', '补种后浇小水'] };
    }
  },
  {
    key: 'wheat.herbicide', crop: 'wheat', source: 'stage',
    test(ctx) {
      if (!(stageIs(ctx, ['leaf3', 'tiller']) || nextIs(ctx, 'leaf3'))) return null;
      if (doneOp(ctx, ['除草'])) return null;
      const start = stageIs(ctx, ['leaf3', 'tiller']) ? ctx.U.today() : (ctx.st.eta || ctx.U.addDays(ctx.U.today(), 7));
      const warm = (ctx.fc || []).filter(f => f.date >= start).slice(0, 10).some(f => f.t >= 10);
      return { title: '冬前化学除草（阔叶杂草）', due: [start, ctx.U.addDays(start, 15)], ref: 'wheatSowing', ops: ['除草'], matType: '农药', target: '阔叶杂草', level: 'week',
        why: ['小麦 3–5 叶期是冬前除草的窗口', warm ? '未来几天日均温在 10℃ 以上，适合施药' : '要等日均温回到 10℃ 以上再打'],
        steps: ['选已登记的除草剂，按登记用量兑水 30 升/亩', '无风晴天上午喷，避开霜冻前后 3 天', '打完记一笔用量'] };
    }
  },
  {
    key: 'wheat.winterWater', crop: 'wheat', source: 'stage',
    test(ctx) {
      if (!stageIs(ctx, ['tiller', 'winter'])) return null;
      if (doneOp(ctx, ['浇水'], ctx.U.addDays(ctx.U.today(), -40))) return null;
      const cold = (ctx.fc || []).find(f => f.t !== null && f.t <= 5);
      if (!cold && !stageIs(ctx, ['winter'])) return null;
      const d = cold ? cold.date : ctx.U.today();
      return { title: '浇越冬水', due: dueAround(ctx.U, d, 2, 7), ref: 'wheatSowing', ops: ['浇水'], level: 'week',
        why: ['日均温将降到 5℃ 左右（' + d.slice(5) + '）', '越冬水能防冻、保墒、踏实土壤'],
        steps: ['日消夜冻前浇完', '墒情好、苗弱的地块可以不浇', '浇后及时划锄'] };
    }
  },
  {
    key: 'wheat.jointFert', crop: 'wheat', source: 'stage',
    test(ctx) {
      if (!(stageIs(ctx, ['joint']) || nextIs(ctx, 'joint'))) return null;
      if (doneOp(ctx, ['施肥'], ctx.U.addDays(ctx.U.today(), -30))) return null;
      const start = stageIs(ctx, ['joint']) ? ctx.U.today() : (ctx.st.eta || ctx.U.today());
      return { title: '拔节肥水', due: [start, ctx.U.addDays(start, 10)], ref: 'wheatSpring', ops: ['施肥', '浇水'], matType: '化肥', level: 'week',
        why: ['进入拔节期，是追氮的关键时候'], steps: ['结合浇水追施尿素 10–15 斤/亩', '旺长的地块推迟到拔节中后期'] };
    }
  },
  {
    key: 'wheat.scab', crop: 'wheat', source: 'stage',
    test(ctx) {
      if (!(stageIs(ctx, ['head']) || nextIs(ctx, 'head'))) return null;
      if (doneOp(ctx, ['打药'], ctx.U.addDays(ctx.U.today(), -10))) return null;
      const rain = (ctx.fc || []).slice(0, 7).filter(f => f.p >= 2).length >= 2;
      const start = stageIs(ctx, ['head']) ? ctx.U.today() : (ctx.st.eta || ctx.U.today());
      return { title: '抽穗扬花期防赤霉病', due: [start, ctx.U.addDays(start, 5)], ref: 'wheatSpring', ops: ['打药'], matType: '农药', target: '赤霉病', level: rain ? 'now' : 'week',
        why: ['抽穗扬花期是赤霉病的防治窗口', rain ? '未来一周有连续降雨，发病风险高' : '见花打药，预防为主'],
        steps: ['见花就打，选已登记的杀菌剂', '打药后 6 小时内遇雨要补喷'] };
    }
  },
  {
    key: 'wheat.dryHotWind', crop: 'wheat', source: 'weather',
    test(ctx) {
      if (!stageIs(ctx, ['fill'])) return null;
      const a = alertOf(ctx, 'dryHotWind'); if (!a) return null;
      return { title: '防干热风：小水浇 + 叶面喷肥', due: [ctx.U.today(), a.start], ref: 'disaster', ops: ['浇水', '施肥'], matType: '化肥', level: 'now',
        why: ['灌浆期遇' + a.text], steps: ['干热风来前小水浇一次', '叶面喷施磷酸二氢钾 150–200 克/亩'] };
    }
  },
  {
    key: 'wheat.harvest', crop: 'wheat', source: 'stage',
    test(ctx) {
      if (!stageIs(ctx, ['mature'])) return null;
      const rain = alertOf(ctx, 'rain');
      return { title: rain ? '雨前抢收小麦' : '适时收获小麦', due: [ctx.U.today(), rain ? ctx.U.addDays(rain.start, -1) : ctx.U.addDays(ctx.U.today(), 5)], ref: 'disaster', ops: ['收获'], level: rain ? 'now' : 'week',
        why: ['已到成熟期（有效积温 ' + ctx.st.gdd + '）'].concat(rain ? [rain.text + '，雨后难以机收'] : []),
        steps: ['蜡熟末期到完熟初期收获', '收后及时晾晒'] };
    }
  },
  // ---------------- 玉米 ----------------
  {
    key: 'corn.topFert', crop: 'corn', source: 'stage',
    test(ctx) {
      if (!(stageIs(ctx, ['joint', 'trumpet']) || nextIs(ctx, 'trumpet'))) return null;
      if (doneOp(ctx, ['施肥'], ctx.U.addDays(ctx.U.today(), -25))) return null;
      return { title: '大喇叭口期追肥', due: [ctx.U.today(), ctx.U.addDays(ctx.U.today(), 10)], ref: 'cornManage', ops: ['施肥'], matType: '化肥', level: 'week',
        why: ['大喇叭口期是玉米需肥最多的时候'], steps: ['追施尿素 20–30 斤/亩', '深施覆土，或趁雨前撒施'] };
    }
  },
  {
    key: 'corn.borer', crop: 'corn', source: 'stage',
    test(ctx) {
      if (!stageIs(ctx, ['trumpet'])) return null;
      if (doneOp(ctx, ['打药'], ctx.U.addDays(ctx.U.today(), -15))) return null;
      return { title: '防治玉米螟', due: [ctx.U.today(), ctx.U.addDays(ctx.U.today(), 7)], ref: 'cornManage', ops: ['打药'], matType: '农药', target: '玉米螟', level: 'week',
        why: ['大喇叭口期是防治玉米螟的关键时期'], steps: ['选已登记的杀虫剂，心叶内喷施或飞防', '打完记一笔用量'] };
    }
  },
  {
    key: 'corn.harvest', crop: 'corn', source: 'stage',
    test(ctx) {
      if (!stageIs(ctx, ['mature'])) return null;
      const rain = alertOf(ctx, 'rain');
      const machine = ctx.lastLogOf(['机械作业', '收获']);
      return { title: rain ? '雨前抢收玉米，收后及时晾晒' : '适时收获玉米', due: [ctx.U.today(), rain ? ctx.U.addDays(rain.start, -1) : ctx.U.addDays(ctx.U.today(), 7)], ref: 'cornHarvest', ops: ['收获', '机械作业'], level: rain ? 'now' : 'week',
        why: ['已到完熟期（有效积温 ' + ctx.st.gdd + '）'].concat(rain ? [rain.text + '，雨后田里泥泞，机收要推迟 5–7 天'] : []).concat(machine && machine.text ? ['你 ' + machine.date.slice(5) + ' 记过「' + machine.text.slice(0, 16) + '」'] : []),
        steps: ['安排机收，先收地势低的地方', '收后摊晾，堆放要苫盖', '籽粒含水 25% 以上的要及时烘干'] };
    }
  },
  // ---------------- 通用：天气 ----------------
  {
    key: 'any.drain', crop: '*', source: 'weather',
    test(ctx) {
      const a = alertOf(ctx, 'rain'); if (!a) return null;
      if (stageIs(ctx, ['mature'])) return null;
      return { title: '雨前清好地头排水沟', due: [ctx.U.today(), ctx.U.addDays(a.start, -1)], ref: 'disaster', ops: ['其他'], level: 'now',
        why: [a.text, '低洼处易积水，影响根系'], steps: ['疏通地头、垄沟排水口', '雨后及时查看积水'] };
    }
  },
  {
    key: 'any.frost', crop: '*', source: 'weather',
    test(ctx) {
      const a = alertOf(ctx, 'frost'); if (!a) return null;
      if (ctx.season.crop === 'wheat' && stageIs(ctx, ['winter'])) return null;
      return { title: '降温霜冻防护', due: [ctx.U.today(), a.start], ref: 'disaster', ops: ['浇水'], level: 'now',
        why: [a.text], steps: ['降温前浇水或镇压', '霜冻后及时查看叶片'] };
    }
  },
  {
    key: 'any.wind', crop: '*', source: 'weather',
    test(ctx) {
      const a = alertOf(ctx, 'wind'); if (!a) return null;
      if (!stageIs(ctx, ['joint', 'head', 'fill', 'trumpet', 'tassel', 'silk', 'milk', 'mature'])) return null;
      return { title: '大风倒伏防护', due: [ctx.U.today(), a.start], ref: 'disaster', ops: ['巡田'], level: 'now',
        why: [a.text, '中后期植株高，容易倒伏'], steps: ['已成熟的抓紧收', '风后及时扶正、培土'] };
    }
  },
  // ---------------- 通用：农户记录 ----------------
  {
    key: 'any.patrol', crop: '*', source: 'record',
    test(ctx) {
      if (ctx.season.status === 'done') return null;
      const last = ctx.lastLogOf(['巡田', '病虫害观察']) || ctx.lastLogOf(null);
      const since = last ? last.date : ctx.season.sowDate;
      const gap = ctx.U.diffDays(since, ctx.U.today());
      if (gap < 7) return null;
      return { title: '去巡一次田，看看长势', due: [ctx.U.today(), ctx.U.addDays(ctx.U.today(), 3)], ref: '', ops: ['巡田'], level: 'soft',
        why: [gap + ' 天没记过巡田了'], steps: ['看苗情、长势、有没有病虫', '记下来，参谋才能看准'] };
    }
  },
  {
    key: 'any.pestRecheck', crop: '*', source: 'record',
    test(ctx) {
      const hit = ctx.logs.filter(l => l.pest && l.date >= ctx.U.addDays(ctx.U.today(), -10)).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      if (!hit) return null;
      if (ctx.logs.some(l => l.date > hit.date && (l.ops || []).some(o => ['打药', '巡田', '病虫害观察'].indexOf(o) >= 0))) return null;
      const d = ctx.U.addDays(hit.date, 4);
      return { title: '复查病虫：' + hit.pest.slice(0, 12), due: [d, ctx.U.addDays(d, 3)], ref: '', ops: ['病虫害观察'], level: 'week',
        why: ['你 ' + hit.date.slice(5) + ' 记了「' + hit.pest.slice(0, 16) + '」'], steps: ['看看有没有扩散', '达到防治指标再用药'] };
    }
  }
];

module.exports = { RULES };
