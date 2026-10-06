// 农历/节气/物候 —— 只用 6tail lunar-javascript 的农事相关部分（农历月日、节气、物候），不用八字宜忌
// 数据全本地计算，零网络；24 节气农谚与农事提示都是全国通用的物候/天气/农活口径，不带地域作物
const { Solar } = require('../vendor/lunar.js');

// [节气, 农谚, 一句农事提示]
const TERMS = [
  ['小寒', '小寒大寒，冻成一团', '农闲积肥，圈舍大棚注意防寒'],
  ['大寒', '大寒到顶点，日后天渐暖', '检修农具，备种备肥迎开春'],
  ['立春', '立春一年端，种地早盘算', '盘算全年种啥，备好农资'],
  ['雨水', '雨水有雨庄稼好', '盯墒情，备春耕'],
  ['惊蛰', '惊蛰春雷响，农夫闲转忙', '春管开始，防虫防病早准备'],
  ['春分', '春分有雨是丰年', '春耕春播大忙，按茬口下种'],
  ['清明', '清明前后，种瓜点豆', '瓜豆蔬菜下种育秧'],
  ['谷雨', '雨生百谷', '大田播种收尾，查苗补苗'],
  ['立夏', '立夏三朝遍地锄', '中耕除草，防病虫害'],
  ['小满', '小满小满，江河渐满', '蓄水防旱，两手准备'],
  ['芒种', '芒种不种，过后落空', '抢收抢种，别误农时'],
  ['夏至', '夏至三庚数头伏', '田间管理关键期，除草追肥'],
  ['小暑', '小暑大暑，上蒸下煮', '防旱防涝，管好水浆'],
  ['大暑', '大暑热不透，大热在秋后', '高温高湿，防伏旱防病虫'],
  ['立秋', '立秋有雨样样收，立秋无雨人人忧', '秋庄稼灌浆结实，水肥别松劲'],
  ['处暑', '处暑满地黄，家家修廪仓', '早熟作物陆续收，修好粮仓'],
  ['白露', '白露秋分夜，一夜凉一夜', '昼夜温差大，晚茬作物管好水肥'],
  ['秋分', '一场秋雨一场寒，十场秋雨要穿棉', '收秋粮、种秋冬作物，两头别误'],
  ['寒露', '寒露到立冬，翻地冻死虫', '收晚熟作物，翻地晒垡'],
  ['霜降', '霜降见霜，米谷满仓', '抢收收尾，注意防霜冻'],
  ['立冬', '立冬之日水始冰，地始冻', '秋收收尾，越冬作物查苗补缺'],
  ['小雪', '小雪雪满天，来年必丰年', '冬闲修渠整地，搞农田基本建设'],
  ['大雪', '瑞雪兆丰年', '冬闲不闲：积肥、修田、学技术'],
  ['冬至', '吃了冬至面，一天长一线', '盘点一年账，盘算明年种']
];

function daysBetween(a, b) { // 'YYYY-MM-DD' 差几天（b-a）
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 864e5);
}
function md(ymd) { return (+ymd.slice(5, 7)) + '/' + (+ymd.slice(8)); }
function lunarOf(ymd) { const [a, b, c] = ymd.split('-').map(Number); return Solar.fromYmd(a, b, c).getLunar(); }

// 一天的全量农历信息：首页卷首 + 节气轴共用
function info(t) { // t = 'YYYY-MM-DD'
  const [y, m, d] = t.split('-').map(Number);
  const l = Solar.fromYmd(y, m, d).getLunar();
  const term = l.getJieQi(); // 今天正好是节气则为名字，否则 ''
  const prev = l.getPrevJieQi(true), next = l.getNextJieQi(true);
  const curName = term || prev.getName();
  const row = TERMS.find(r => r[0] === curName) || [];
  return {
    dayText: l.getDayInChinese(), monthText: l.getMonthInChinese() + '月',
    gz: l.getYearInGanZhi() + '年', hou: l.getHou(),
    term, curName, proverb: row[1] || '', tip: row[2] || '',
    next: { name: next.getName(), days: daysBetween(t, next.getSolar().toYmd()) },
  };
}

module.exports = { info };
