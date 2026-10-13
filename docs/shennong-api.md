# 神农 API（中国农大）接入调研 · 2026-10-13

> 来源：平台官方站点与开发者文档实测读取（api.agent-tech.cc，神农大模型开放平台）。
> 结论：**接入方式已摸清，契约与我们 advisorChat/advisorAgent 的 OpenAI 兼容槽位完全同构**；只差账号（短信登录）→ 拿 Key → 实测调用。

## 1. 平台提供什么

- 农业垂直大模型（V4.0，3.0 已过国家备案），OpenAI 兼容对话接口 + **服务端执行的农业工具**。
- 服务端工具（模型自主触发，结果进 `tool_results`，计入用量）：

| 工具 ID | 能力 | 与田祖记的关系 |
|---|---|---|
| `pest_classify_grain_crop` | 粮食作物病虫害图片识别（**小麦、玉米**、水稻、大豆等） | ★ 直接命中我们的作物，产品真空缺 |
| `pest_classify_cash_crop` / `pest_classify_fruit_vegetable` / `pest_classify_other` | 经济作物/果蔬/杂草地下害虫识别 | 备用 |
| `vet_list_species` / `vet_classify_disease` | 畜禽疾病图片推理（牛猪羊鸡） | 用不上（纯种植） |
| `weather_get_forecast` / `weather_get_history` | 县域天气预报/历史（Open-Meteo） | 我们已有同款免费链路 |
| `drought_get_county_level` / `drought_get_point_level` / `drought_get_metadata` | 月尺度植被干旱等级（VCI，县级/单点） | ▲ 有意思：比降雨更贴近「该不该浇水」，可评估 |

## 2. 接入契约（官方文档原文要点）

- **Base URL**：`https://api.agent-tech.cc/api/v1`
- **端点**：`POST /chat/completions`（OpenAI Chat Completions 兼容，可直接用 OpenAI SDK，只换 base_url）
- **鉴权**：`Authorization: Bearer sk-nong-xxxxxxxx`（控制台「API Keys」创建，仅创建时完整展示一次）
- **模型**：固定 `sn`；`stream` 支持 SSE；`enabled_tools` 限定服务端工具（省略=全开，空数组=全关）；客户端 function tools 照常支持（服务端不执行）
- **多模态**：`image_url` 公网 URL（≤20MB）或 base64 data URL；图片 ingest 后生成 `file_id` 供识别工具使用
- **响应扩展**：`tool_results`（工具执行输入/输出，调试审计用）
- **计费**（余额规则 2026-08-04 版）：预充值余额，**¥1 ≈ 5 万 tokens，小模型每次调用 ¥0.1**；充值满赠（300/500/1000/2000 → 5%/8%/12%/15%）；余额长期有效；**注册赠送/兑换码额度优先抵扣**（即有免费试用额度，登录后控制台可见）

## 3. 与田祖记的集成路径（待账号后执行）

我们 `config` 集合 `advisor_ai` 文档就是 baseUrl+apiKey+model 三件套（DeepSeek→云开发网关已验证过这个换法）。神农接入有两种用法：

- **A. 参谋外援工具（推荐方向）**：编排仍走混元 hy3（免费额度到 2027-04），把「拍照识病虫害」做成 `advisorAgent` 的一个新工具——用户发图 → 云函数转 base64/URL 调神农 `pest_classify_grain_crop` → 结果回到参谋话术，再接我们已有的农药登记校验（kb）给用药建议。补的是真能力空缺。
- **B. 整模型切换**：把 `advisor_ai` 配置指向神农（baseUrl+sk-nong key+model=sn）。代码零改动，但失去免费额度且农事编排 prompt 是按 hy3 调的，不建议为主。

合规注意：线上生成式回答若改由神农提供，深度合成类目的第三方算法材料（现挂腾讯云算法资质）需要对应更新——走「主模型仍是混元、神农只做工具」的 A 方案则不影响现有类目材料。

## 4. 当前状态与下一步

- [x] 平台/文档/计费/工具清单已实测读取（本文件）
- [ ] 账号注册（短信登录，需机主本人）：登录页已在浏览器打开（api.agent-tech.cc/login）
- [ ] 控制台查看注册赠送额度 → 创建 API Key（sk-nong-...，仅创建时可见）
- [ ] 真实调用验证：文本问答一条 + 小麦病虫害图片识别一条（用真叶片照片），记录延迟/回答质量/扣费
- [ ] 评估后决策：是否把「拍照识病虫害」排进产品（挂 advisorAgent 新工具）
