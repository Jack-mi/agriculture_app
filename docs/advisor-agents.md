# 农事参谋 · 多智能体系统设计

> 原则：**问答 100% 走大模型，没有本地规则兜底**。模型可以参考知识库与规则资料，但任何回答都出自模型。架构参照 Codex 的 agent loop 语义（propose → validate → permission → execute → observe）。

## 运行时

生产环境是云函数 `advisorAgent`。总管只带 3 个工具：`ask_bookkeeper`、`ask_logger`、`ask_agronomist`。三个子代理在同一次云函数里各跑自己的工具循环，不把全部工具塞进总管的上下文。

| 子代理 | 只管 | 工具 |
|---|---|---|
| 记账 | 收支记账（收入/支出）、赚了花了、欠款销账、账户、库存、周期账、常用账、预算、记账/收入类型 | `query_costs`、`query_summary`、`query_accounts`、`query_debts`、`query_recurring`、`query_templates`、`query_stock`、`query_budget`、`draft_cost`（收支双态+5 种算法+挂赊+账户）、`draft_cost_remove`（软删）、`draft_cost_tag`、`draft_income_tag`、`draft_debt_settle`、`draft_recurring`、`draft_stock_adjust` 及地块/种植季查询 |
| 记事 | 农活（含编辑已有日志）、记事类型、提醒和待办 | `query_logs`、`query_tasks`、`draft_log`、`draft_log_update`、`draft_log_remove`、`draft_log_tag`、`draft_task*` |
| 农事决策 | 能不能打药、技术依据、生育期、开季收获、改播种时间/播量/整地、地块、选位置、改正某一天天气 | `kb_search`、`pesticide_check`、天气预报、`draft_locate`、`draft_weather`、`draft_season_update`、地块/种植季起草 |

地图选点：子代理只起草确认卡，确认后手机打开地图，点一下才写入经纬度。云函数拿不到定位。自定义类型和手工改天气也是确认后由小程序写入。

模型调用次数大家共用，最多 20 次。总管和子代理从同一笔预算里扣，不再单独卡住 3 轮或 4 轮。原来单循环写死 8 轮，是怕云函数大约 60 秒超时；20 是调用次数上限。墙钟仍大约 60 秒，轮次多时可能在用满 20 次之前被平台掐掉。

## 工具契约（云函数内实现，schema 校验）

只读：`query_plots`、`query_seasons`、`query_logs`、`query_costs`、`query_tasks`、`query_weather`、`weather_forecast`、`kb_search`、`pesticide_check`、`memory_search`、`query_summary`、`query_accounts`、`query_debts`、`query_recurring`、`query_templates`、`query_stock`、`query_budget`
起草（权限门，农户在 App 里点确认才落库）：`draft_plot`、`draft_plot_update`、`draft_plot_remove`、`draft_locate`、`draft_season`、`draft_season_update`、`draft_harvest`、`draft_season_remove`、`draft_variety`、`draft_task`、`draft_task_move`、`draft_task_skip`、`draft_task_done`、`draft_log`、`draft_log_update`、`draft_log_remove`、`draft_log_tag`、`draft_cost`、`draft_cost_remove`、`draft_cost_tag`、`draft_income_tag`、`draft_debt_settle`、`draft_recurring`、`draft_stock_adjust`、`draft_weather`、`draft_stage`、`memory_save`、`memory_forget`。模型永远没有直接写权限。删除类起草在客户端一律软删（进回收站 30 天可恢复），与手动删除同口径。

## 数据与隐私

- 云函数按 `_openid` 过滤，农户只读自己的数据；知识库（kb/）随包内置，不走库。
- 对话按微信账户存在本机，并同步到云端集合 `advisorThreads`（按 `threadKey` 查询，权限是仅创建者可读写，所以不用把 openid 写进文档 id）。换机打开同一账号能拉回。模型上下文仍只带最近 12 条文本，不含工具轨迹。

## 失败语义

- 模型/网络失败：直说"参谋暂时连不上"，**不回落本地规则**（本地解析已整链删除）。
- 一次请求里模型调用合计不超过 20 次。云函数目标超时 60 秒，长链路可能提前被掐掉。
