const test = require('node:test');
const assert = require('node:assert');
const { parseTrace } = require('../utils/trace.js');

test('空 trace / 非数组 → 空步骤', () => {
  assert.deepStrictEqual(parseTrace(null), []);
  assert.deepStrictEqual(parseTrace([]), []);
  assert.deepStrictEqual(parseTrace('ask_bookkeeper'), []);
});

test('真实链路：叫来记账参谋 → 翻账本合并 → 确认卡汇总', () => {
  const steps = parseTrace(['ask_bookkeeper', '记账:query_summary', '记账:query_costs', '记账:query_budget', '记账:draft_cost']);
  assert.deepStrictEqual(steps, [
    { text: '叫来记账参谋', n: 1, expert: true },
    { text: '翻了账本', n: 2, expert: false },
    { text: '对了预算', n: 1, expert: false },
    { text: '拟好了 1 张确认卡', n: 1, expert: false }
  ]);
});

test('农事链路 + 未知工具兜底，不裸奔英文', () => {
  const steps = parseTrace(['ask_agronomist', '农事决策:weather_forecast', '农事决策:pesticide_check', '农事决策:new_tool_x']);
  assert.deepStrictEqual(steps.map(s => s.text), ['叫来农事参谋', '看了天气', '核对了打药安全', '查了一下资料']);
});

test('多个子代理 + 多张草稿', () => {
  const steps = parseTrace(['ask_bookkeeper', '记账:query_costs', 'ask_logger', '记事:query_logs', '记事:draft_log', '记事:draft_task']);
  assert.deepStrictEqual(steps.map(s => s.text), ['叫来记账参谋', '翻了账本', '叫来记事参谋', '翻了农事记录', '拟好了 2 张确认卡']);
});

test('超过 7 步折叠中间', () => {
  const trace = ['ask_bookkeeper'];
  ['query_costs', 'query_debts', 'query_accounts', 'query_stock', 'query_budget', 'query_logs', 'query_tasks', 'kb_search'].forEach(t => trace.push('记账:' + t));
  const steps = parseTrace(trace);
  assert.strictEqual(steps.length, 7);
  assert.strictEqual(steps[3].folded, true);
  assert.strictEqual(steps[3].text, '等 3 步');
});
