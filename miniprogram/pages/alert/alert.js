// 天气预警详情：触发条件 + 对每块地的影响 + 已生成的任务
const store = require('../../utils/store.js');
const advisor = require('../../utils/advisor.js');
const growth = require('../../utils/growth.js');
const C = require('../../utils/const.js');

const NAME = { rain: '连阴雨', frost: '降温霜冻', wind: '大风', dryHotWind: '干热风' };
const IMPACT = {
  rain: { mature: ['影响大', '成熟作物雨后无法机收，籽粒易霉变、穗发芽'], _: ['有影响', '低洼处易积水，影响根系'] },
  frost: { _: ['有影响', '叶片可能受冻，弱苗更要当心'] },
  wind: { _: ['有影响', '中后期植株高，容易倒伏'] },
  dryHotWind: { fill: ['影响大', '灌浆期遇干热风会逼熟，粒重下降'], _: ['注意', ''] }
};
const TYPE_RULES = { rain: ['harvest', 'drain'], frost: ['frost', 'winterWater'], wind: ['wind', 'harvest'], dryHotWind: ['dryHotWind'] };

Page({
  data: { a: null, plots: [] },
  onLoad(q) {
    const key = decodeURIComponent(q.key || '');
    const v = advisor.today();
    const a = v.alerts.find(x => x.key === key) || v.alerts[0];
    if (!a) return wx.navigateBack();
    const plots = store.seasons.growing().filter(s => advisor.alertsOf(advisor.forecastOf(s.plotId)).some(x => x.type + x.start === a.key)).map(s => {
      const p = store.plots.get(s.plotId) || {};
      const st = growth.current(s).stage;
      const imp = IMPACT[a.type][st.key] || IMPACT[a.type]._;
      const tasks = store.tasks.bySeason(s.id).filter(t => t.status === 'open' && TYPE_RULES[a.type].some(k => (t.key || '').indexOf(k) >= 0)).map(t => ({ id: t.id, title: t.title }));
      return { id: s.id, name: p.name, crop: C.cropOf(s.crop).name, cls: C.cropOf(s.crop).cls, icon: C.cropOf(s.crop).icon, stage: st.name, lv: imp[0], text: imp[1], tasks };
    });
    const days = (a.days || []).map(d => ({ date: advisor.md(d.date), p: d.p, t: d.t, tmin: d.tmin, wind: d.wind }));
    this.setData({ a: Object.assign({}, a, { name: NAME[a.type] || '天气预警', days }), plots });
    wx.setNavigationBarTitle({ title: '天气预警' });
  },
  goTask(e) { wx.navigateTo({ url: '/pages/task/task?id=' + encodeURIComponent(e.currentTarget.dataset.id) }); }
});
