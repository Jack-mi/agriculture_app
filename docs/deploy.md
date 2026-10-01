# 谷雨记 · 部署文档（云开发后台 + 微信登录 + 账号体系）

> **当前已落地状态（2026-09-29 实测）**
> - AppID：`wxd63b1265355b0538`（复用旧小程序「Londdon123kkk」）
> - 云环境：`cloud1-d5gzevmwkdff99eb5`（微信云开发，免费额度；已写入 `miniprogram/app.js` 的 `CLOUD_ENV`）
> - 数据库：7 个集合已建（users / plots / seasons / costs / logs / weather / tags）
> - 云函数：`login` / `weatherDaily` / `weatherBackfill` 已部署并实测可调用
> - 端到端实测通过：小程序 → `wx.cloud.callFunction('login')` → users 落库；新建地块 → outbox flush → plots 落库（`_openid` 正确）
> - **待补一步**：`weatherDaily` 的每日 06:30 定时触发器（见下方第 3 节末「上传触发器」）
> - 另有一个腾讯云侧体验版环境 `agriculture-d0gdtw8zdf310a44a`（6 个月体验版，同 AppID 已绑定），走的是腾讯云账号通道；小程序端只用 `cloud1` 那个。
>
> **2026-09-29 更新**
> - 体验版已上传：版本号 `0.1.0`（mp 后台「版本管理 → 开发版本」，可扫体验版二维码真机测试）
> - **2026-09-30：体验版 `0.2.0` 已上传**（农事日志 + 多地块成本分摊 + 每日风力；云函数 weatherBackfill/weatherDaily 已重新部署，风力单位 m/s）
> - **2026-09-30：体验版 `0.3.0` 已上传**（随手记式记一笔：键盘/按亩计/按亩均摊 + 流水按日/日历 + 常用账 + 作物品种；纯前端改版，云函数未动）
> - **2026-10-01：体验版 `0.4.0` 已上传**（农事参谋一期：今天页两态/预警/待办/参谋标签页/任务/生育期/跟参谋说；新增云函数 `weatherForecast` 已部署；新建集合 `tasks`、`memory`；WechatSI 插件因后台添加失败暂未声明，聊天页降级打字，添加后恢复 app.json 的 plugins 声明即可）
> - 小程序名已变更为 **田祖记**（原名 Londdon123kkk，改名审核已生效）
> - 地理位置接口申请（`wx.chooseLocation` + `wx.getFuzzyLocation`）**审核中**；未批前上传会报 `-80424 ... is not authorized`
>   - 因此当前 `app.json` 的 `requiredPrivateInfos` **临时只声明 `["chooseLocation"]`**，保证体验版可上传、地图选点可用
>   - 接口审批通过后需改回 `["chooseLocation", "getFuzzyLocation"]` 并重新上传（「用当前位置」按钮依赖它）
>   - 注意：`getFuzzyLocation` 与 `getLocation` 在 `requiredPrivateInfos` 中**互斥**，不能同时声明
> - 腾讯云侧 `agriculture-…` 环境已隔离、2026-09-29 到期释放（仅早期试跑数据）
> - 主体变更（个人刘小粟 → 上海河畔小伴科技有限公司）审核中（约 7 个工作日）；通过后需管理员扫码确认并签服务协议
> - 主体变更通过后再做：企业认证（300 元/年）→ 开通「虚拟支付」（收 VIP 会员费）→ 小程序备案（公司主体）→ 提审发布

架构：小程序端离线优先（本地 Storage 为缓存），云开发做后台——云数据库 7 个集合 + 3 个云函数。
账号体系 = `wx.login` openid 静默建档，无注册流程；所有集合按 `_openid` 天然隔离。

## 1. 前置（一次性，约 10 分钟）

1. **真实 AppID**：注册微信小程序（个人主体即可），把 `project.config.json` 的 `appid` 从 `touristappid` 换成你的 AppID。测试号无法开通云开发。
2. **开通云开发**：开发者工具 → 工具栏「云开发」→ 开通 → 记环境 ID（如 `guyuji-prod-xxx`）。
3. **填环境 ID**：`miniprogram/app.js` 顶部 `const CLOUD_ENV = ''` 填入环境 ID。

## 2. 建集合（云开发控制台 → 数据库）

| 集合 | 权限 | 说明 |
|---|---|---|
| `users` | 仅创建者可读写 | 登录建档（login 云函数维护） |
| `plots` | 仅创建者可读写 | 地块 |
| `seasons` | 仅创建者可读写 | 种植季 |
| `costs` | 仅创建者可读写 | 记账流水 |
| `logs` | 仅创建者可读写 | 记事流水 |
| `weather` | 仅创建者可读写 | 逐日天气，`_id = plotId@date` 天然唯一，无需另建索引 |
| `tags` | 仅创建者可读写 | 用户自定义类型（每用户单文档） |

建议再给 `plots/seasons/costs/logs/weather` 的 `updatedAt` 建普通索引（增量同步按它过滤排序）。

## 3. 部署云函数

开发者工具左侧 `cloudfunctions/` 目录，逐个右键：

| 云函数 | 作用 | 部署方式 |
|---|---|---|
| `login` | openid 静默建档 | 上传并部署：云端安装依赖 |
| `weatherBackfill` | 开季回补 + 手动重取天气 | 上传并部署：云端安装依赖 |
| `weatherDaily` | 每日 06:30 为在种的季拉昨日天气 | 上传并部署：云端安装依赖 + **上传触发器** |

`weatherDaily` 的定时触发器在 `config.json` 里（cron `0 30 6 * * * *`），部署时选「上传并部署：所有文件」会自动带上；也可在云控制台手动核对触发器是否存在。

## 4. 隐私与权限配置（小程序后台 mp.weixin.qq.com）

- **用户隐私保护指引**（设置 → 服务内容声明）：声明「位置信息」（用于地块定位获取天气）。头像/昵称本期未做 UI，无需声明。
- **接口设置**（开发管理 → 接口设置）：`wx.chooseLocation`、`wx.getFuzzyLocation` 已于 2026-09-30 开通，`app.json` 的 `requiredPrivateInfos` 同步声明这两个；`wx.getLocation` 暂无自助申请通道（见第 7 节）。
- **上线前必做**：`wx.getLocation` 一旦开通，需在隐私指引补声明「精确位置」，并把 `plot-edit.js` 里的 `PRECISE_LOCATION` 开关置 `true` 后重新上传。
- **服务器域名**：无需配置 Open-Meteo（天气已改走云函数，服务端直连）。无其他 request 域名。

## 5. 数据流说明（排障用）

- **写**：页面改数据 → 本地 Storage 立即落盘 + 变更进 outbox（`guyuji_outbox`）→ 3 秒节流/联网恢复时逐条 upsert 到云端集合。删除走墓碑（outbox 里的 remove 条目）。
- **拉**：启动/网络恢复时按 `updatedAt > guyuji_lastpull` 增量拉取合并；冲突 Last-Write-Wins；`src=manual` 的天气永不覆盖。
- **天气**：`weatherDaily` 每日 06:30 自动回填昨日；开季和「重新获取天气」走 `weatherBackfill`（近 30 天 forecast、更早 archive）。
- **换机**：新设备登录同微信号 → pull 全量 → 本地缓存自动重建。

## 6. 验收 checklist

- [ ] 首开：users 集合出现一条自己的记录（isNew）
- [ ] 建地块（定位）→ plots 集合出现记录
- [ ] 开季 → seasons 出现记录，且 weather 集合在几秒内回补播种日以来的逐日天气
- [ ] 记一笔账 / 记事 → costs / logs 出现记录
- [ ] 手工修正某天气温 → weather 对应记录 src=manual；再点「重新获取天气」不被覆盖
- [ ] 次日 06:30 后：昨日天气自动出现在 weather 集合
- [ ] 删除一季 → 云端 costs/logs/seasons 级联消失
- [ ] 清空小程序缓存重进 → 数据完整恢复

## 7. 待办与阻塞项

- **wx.getLocation（精确位置）**：后台接口权限页显示 `暂无权限`，原因是 `类目未符合开通条件，请确保小程序具备与实时地理位置强相关的使用场景`。实测直连申请页 `/wxamp/accessapi?api_name=wx.getLocation` 可填可传图，但 `POST /wxamp/cgi/development/ApplyPrivacyApi` 一律返回 `{"errorMsg":"系统异常，请稍后重试","can":true}`，状态停在 `status=2`，**没有可用的自助申请通道**（无效应答：无效接口名/空内容返回同一条错误）。
  - 待办：主体变更到企业主体后，在加服务类目那一步同时看能否加「实时地理位置强相关」类目，再申请。
  - 代码已就绪：`pages/plot-edit/plot-edit.js` 的 `useCurrent()` 是「`wx.getLocation` 优先 + `wx.getFuzzyLocation` 回退」，开关 `PRECISE_LOCATION` 现为 `false`。
- **主体变更**：个人主体 → 上海河畔小伴科技有限公司，审核中（2026-09-29 被要求补正：用官方模板、不接受电子章电子签名、日期只到日）。待签章的申请函在 `~/Documents/谷雨记-主体变更材料/`。
- **收费能力**：类目只解决合规，会员收费要靠企业主体认证后开通「虚拟支付」；`users` 加会员字段 + 新增 `orders` 集合的方案待主体落地后再做。
