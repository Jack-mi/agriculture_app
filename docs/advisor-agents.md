# 农事参谋 · 多智能体系统设计

> 原则：**问答 100% 走大模型，没有本地规则兜底**。模型可以参考知识库与规则资料，但任何回答都出自模型。架构参照 Codex 的 agent loop 语义（propose → validate → permission → execute → observe），参照 agents-best-practices v1.10.0（c7e49ac）。

## 为什么生产环境不直接跑 Codex SDK

`@openai/codex-sdk` 依赖本机 Codex CLI 运行时，微信云函数（serverless、无持久进程）装不了也起不来。因此：
- **生产运行时**：云函数 `advisorAgent`，用 DeepSeek 原生 tool-calling 实现同一套 loop 语义（schema 校验、权限门、写操作确认制）。
- **Codex SDK 的使用位置**：本机开发/评测 harness（`agents/` 目录），用 Codex SDK 线程跑同一套工具契约做回归评测，模型走 Friday 网关的 deepseek-v4-flash。

## 智能体分工

| Agent | 角色 | 直接工具 |
|---|---|---|
| 总管 Orchestrator | 唯一对话入口，理解意图、调工具、汇总回答 | 全部只读工具 + 三个写工具的"起草"形态 |
| 农艺师 Agronomist | 问答专家：生育期、水肥、植保、灾害 | kb_search、pesticide_check、query_seasons、weather_forecast |
| 账房 Bookkeeper | 数据问答与起草：花了多少、上次啥时候干的、记一笔 | query_logs、query_costs、draft_log、draft_cost |
| 气象员 Weather | 天气相关：能不能打药、未来几天 | query_weather、weather_forecast |

子 Agent 不是独立进程，是总管的**专家工具调用**：总管判断问题域后，以专家人设+该域工具集再跑一轮有界 loop，拿回结构化结论再统一作答。起步只有一轮主 loop + 按需一轮专家 loop（上限 6 次工具调用/轮）。

## 工具契约（云函数内实现，schema 校验）

只读：`query_seasons`、`query_logs`、`query_costs`、`query_tasks`、`query_weather`、`weather_forecast`、`kb_search`、`pesticide_check`、`memory_search`
起草（权限门）：`draft_task`、`draft_log`、`draft_cost`、`memory_save` —— 返回起草卡片，**农户在 App 里点确认才落库**；模型永远没有直接写权限。

## 数据与隐私

- 云函数按 `_openid` 过滤，农户只读自己的数据；知识库（kb/）随包内置，不走库。
- 对话历史最多 12 条由客户端携带；服务端不存对话。

## 失败语义

- 模型/网络失败：直说"参谋暂时连不上"，**不回落本地规则**（本地解析已整链删除）。
- 工具超时 30s、单轮 6 次调用封顶、整轮 8 次模型调用封顶。
