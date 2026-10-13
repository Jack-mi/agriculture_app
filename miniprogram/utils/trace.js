// 思维链步骤翻译：advisorAgent 回包里的 toolTrace → 农户看得懂的步骤
// trace 格式：总管步骤是 'ask_bookkeeper'，子代理步骤是 '记账:query_costs'
// 纯函数、无 wx 依赖，可用 node 直接自测（tests/trace.test.js）
const EXPERT_TEXT = {
  ask_bookkeeper: '叫来记账参谋',
  ask_logger: '叫来记事参谋',
  ask_agronomist: '叫来农事参谋'
};
const TOOL_TEXT = {
  query_costs: '翻了账本', query_summary: '翻了账本',
  query_debts: '查了欠款', query_accounts: '看了账户余额',
  query_stock: '查了库存', query_budget: '对了预算',
  query_recurring: '查了周期账', query_templates: '查了常用账',
  query_logs: '翻了农事记录', query_tasks: '看了待办',
  query_plots: '看了地块和种植季', query_seasons: '看了地块和种植季',
  query_weather: '看了天气', weather_forecast: '看了天气',
  kb_search: '查了农技资料', pesticide_check: '核对了打药安全',
  memory_search: '翻了记住的事', memory_save: '记下了一条', memory_forget: '忘掉了一条'
};

// → [{ text, n, expert, folded? }]，连续相同合并；draft_* 汇总成一条；超过 7 步折叠中间
function parseTrace(trace) {
  const steps = [];
  let drafts = 0;
  (Array.isArray(trace) ? trace : []).forEach(t => {
    t = String(t || '');
    if (!t) return;
    const isExpert = !!EXPERT_TEXT[t];
    let text = EXPERT_TEXT[t] || '';
    if (!text) {
      const tool = t.indexOf(':') >= 0 ? t.split(':')[1] : t;
      if (/^draft_/.test(tool)) { drafts += 1; return; }
      text = TOOL_TEXT[tool] || '查了一下资料';
    }
    const last = steps[steps.length - 1];
    if (last && last.text === text) last.n += 1;
    else steps.push({ text, n: 1, expert: isExpert });
  });
  if (drafts) steps.push({ text: '拟好了 ' + drafts + ' 张确认卡', n: 1, expert: false });
  if (steps.length > 7) {
    const head = steps.slice(0, 3), tail = steps.slice(-3);
    return head.concat([{ text: '等 ' + (steps.length - 6) + ' 步', n: 1, expert: false, folded: true }], tail);
  }
  return steps;
}

module.exports = { parseTrace };
