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
> - **2026-10-01：体验版 `0.4.1` 已上传**（参谋 AI 模型可切换：本地规则/混元 Turbo/DeepSeek V3/R1 + BYOK 自带 Key；新增云函数 `advisorChat`（OpenAI 兼容代理，Key 存云端 `config` 集合，仅创建者可读写）已部署并实测 status/chat 通道；新建集合 `config`。云开发 AI 额度未开通（需管理员扫码进腾讯云控制台），微信同声传译插件添加被平台拒（214008，疑似主体变更审核中限制））
> - **2026-10-05：体验版 `0.7.0` 已上传 —— 收支双向 + 库存/欠款/报表/回收站 + 预算/资金账户/资产负债**
>   - 记账改成**收支双态**（`costs[i].dir` = `out`/`in`，旧数据无 `dir` 一律按支出，零迁移）；新增收入类型（卖粮/补贴/土地租金/农机服务/保险赔付/其他，可自定义）
>   - 新增算法：按斤×价、按亩×价；新增字段：`debt`（赊账/欠款，可部分销账）、`attachments`（附件，先本机后云存储 fileID）、`audit`（操作留痕，关键动作 + 时间戳）、`deletedAt`（软删进回收站，30 天后本机清理）
>   - 新增/重写页面：`ledger`（账本一级 tab：全部地块统一流水 + 六维筛选 + 列表/月历/周历）、`report`（净收益总览/结构/趋势）、`debt`（欠款台账）、`stock`（农资/粮食库存）、`trash`（回收站）、`recurring`（周期账与分期）、`catchup`（连续补账）、`keypanel`（记账键盘设置）；`cost-edit` / `index` / `mine` / `season` / `tags` / `harvest` / `log-edit` / `keypad` 同步升级
>   - TabBar 由 3 个变 4 个（今天 / **账本** / 地块 / 我的）
>   - **不新增云端集合**：欠款挂 `costs.debt`、库存挂 `tags.stock`、周期账挂 `tags.recurring`、键盘偏好只存本机 `guyuji_kp_pref`；`sync.js` 补了深层 `undefined` 清洗（附件 fileID 这类嵌套字段以前会让整条写库失败）
>   - 自检：`node --test miniprogram/tests/*.test.js` → 51/51 通过；`node scripts/check-miniprogram.js` → 25 个页面 + keypad 全通过（含 wxml 事件与模块方法核对）
>   - 本轮补齐的 3 个记账缺口（对照随手记最新能力清单）：
     - **预算**：`seasons[i].budget = { total, perMu, cats }`；有效预算 = 总预算优先，其次「每亩目标 × 地块面积」；本季支出 ≥ 90% 时首页与账本各出一条提醒。新增页 `pages/budget`
     - **资金账户**：`tags.accounts = [{key,name,init}]` + `costs[i].account`；余额 = 期初 + 实收 − 实付（挂了赊账的只算已销账金额，不和应收重复）；账本筛选抽屉新增账户维度。新增页 `pages/funds`
     - **资产负债总览**：账户余额 + 库存估值 + 应收 − 应付 = 净资产。新增页 `pages/balance`
   - 顺带修掉：`pages/ledger/ledger.wxss` 尾部混入了两行 shell 残留（`JSEOF` / `echo written`），导致整包 WXSS 编译失败；已删除并补齐账本页缺失样式。另把 `.flow/.fic/.f-t/.f-a/.tabs/.tab/.kv/.sheet-lb/.link/.stack` 提到 `app.wxss` 统一，欠款/报表/库存页的分段控件原来没有样式（竖着堆）。
   - 自检：`node --test miniprogram/tests/*.test.js` → 51/51；`node scripts/check-miniprogram.js` → 25 页 + keypad 全通过；模拟器逐页截图存 `docs/design/verify/`
   - **上传记录**：2026-10-05 `upload --upload-version 0.7.0`，代码包 517,578 B（TOTAL 1 个包），`taskId=confirmation_upload_572b3961…` 经 IDE 确认后 `execution_success`
   - **官方体验版二维码**：`docs/trial-qr-0.7.0.png`（mp.weixin.qq.com → 管理 → 版本管理 → 开发版本 → 体验版 → 下载二维码；路径 `pages/index/index`，**该二维码 10 月 12 日前有效**）
   - **待办**：真机扫码回归（体验版 0.7.0）
> - **2026-10-05：体验版 `0.7.1` 已上传**（真机反馈修复，二维码同 `docs/trial-qr-0.7.0.png`，体验版二维码指向最新上传，无需换码）
>   - 记一笔：chip 行原来挤在 `scroll-view` 里被压扁 → 字全糊；改成换行铺满、每个 chip 自己撑开（只有「分摊」限宽省略）
>   - 所有弹层加右上角 ✕（7 个页面 16 处）；赊账弹层另补「取消」按钮
>   - 键盘按压反馈去掉 `filter: brightness()` / `transform`（iOS 上会整块重绘，看起来在抖）；记一笔 / 连续补账改 `position: fixed` + `overflow: hidden`，不再被底部安全区撑出可滚动高度
>   - 连续补账重做：日期可点选年月日（`picker mode=date`）、页内直接记账（分类 + 键盘 + 保存，不再二次跳转）、删掉「只写记事 / 这天没事 / 最近记的 / 底部说明」
>   - 自检：51/51 + 25 页静态检查；模拟器复核 `docs/design/verify/catchup.jpg`、`cost-edit.jpg`、`cost-edit-debt.jpg`
> - **2026-10-05：体验版 `0.7.2` 已上传**（弹层返回问题）
>   - 根因：弹层内容比屏幕高时，`.mask` 的 `align-items: flex-end` 会把 sheet 顶出屏幕上方——右上角 ✕ 看不见、上方遮罩也点不到，于是「没法返回」
>   - 修法：`.sheet` 统一加 `max-height: 88vh` + 内部滚动（内容再多也不会顶出屏幕，✕ 和遮罩始终可点）；账本筛选抽屉底部另加「取消」按钮
>   - 自检：51/51 + 25 页静态检查；模拟器验证 `docs/design/verify/ledger-filter.jpg`（✕ 可见、遮罩可点、sheet 高度 590px ≈ 88vh），`outerWxml` 复核 `.sheet` 内确有 `sh-close` 与「取消」
> - **2026-10-05：体验版 `0.7.3` 已上传**（三条真机反馈）
>   - ✕ / 取消 点不动：根因是 `closeSheet()` 里还挂着「欠款没填名字就不许关」的校验，✕ 和遮罩都走同一个 handler → 弹 toast 且不关闭。改为关闭即关闭（同时清 `debtPending`），分摊校验也一并去掉
>   - 库存页卡片下面漏出半个「初」：期初按钮文案 9 字放不下 → 换行到框外。`.btn` 统一加 `overflow: hidden`，文案缩短为「按现在剩的填期初」
>   - 每笔账的备注：从「地块 · 算法」那行拆出来，单独一行 + 麦色竖线（账本流水 / 当日明细 / 季详情流水三处统一）
>   - 自检：51/51 + 25 页静态检查；模拟器实测：`.sh-close` 点击后 `.sheet` 消失（no such element）、无 toast；库存页「初」不再漏出；给 2026-10-03 农药那笔加备注后 `docs/design/verify/ledger-note.jpg` 可见独立备注行（验证完已清掉该测试备注）
> - **2026-10-05：体验版 `0.7.4` 已上传**（两条真机反馈）
>   - 「这笔账」详情页：备注行原来是 `wx:if`，没备注就整行不显示 → 用户以为这页没有备注。改成**常显**：有备注显示内容，没备注显示「没写备注 · 点这里去补 ›」并可点进编辑
>   - 连续补账：没有缺记日子时点 `›` 会弹「这段没有缺记的日子」，看不懂。改为**点了什么都不做**（箭头本就是灰的），并把头部改成「已记齐，没有要补的」+ 一行说明「这个范围里每天都记过了，不用补；要单独补某一天，点下面的日期选」，同时隐藏 0% 进度条
>   - 自检：51/51 + 25 页静态检查；模拟器复核 `docs/design/verify/cost-detail.jpg`、`catchup.jpg`
> - **2026-10-05：体验版 `0.7.5` 已上传**（去掉「操作留痕」版块）
>   - 「这笔账」详情页的「操作留痕」整块删除（用户要求，别占版面）；`costs[i].audit` 仍在写数据（回收站/对账口径用、单测 `销账有留痕` 依赖它），只是界面不再展示
>   - 设计稿同步：F8 标题「流水详情（含留痕）」→「流水详情」、F21「回收站 + 操作留痕」→「回收站」（并把两处 mock 里的留痕块删掉）、覆盖清单 P1-12 改为「误删恢复（回收站）；操作留痕只写数据、界面不展示」、口径表留痕一行补「只写不展示」
>   - 自检：51/51 + 25 页静态检查；模拟器复核 `docs/design/verify/cost-detail.jpg`（留痕块已消失）
> - **2026-10-06：体验版 `0.7.6` 已上传**（「这笔账」详情页三条真机反馈，二维码同 `docs/trial-qr-0.7.0.png`，无需换码）
>   - **分摊明细那行没对齐**：`cost-detail.wxss` 里 `.kv.sub { padding-left: 24rpx }` 把「东大块 · 小麦 · 2026–2027」整行缩进了，「分摊到」却不缩进 → 两行左右都错位。删掉 `.sub` 缩进，分摊明细统一用普通 `.kv`，与上行左右对齐
>   - **备注编辑不再跳页**：原来点备注行会 `navigateTo` 到「记一笔」页。改成**当前页就地编辑**——点备注行弹底部输入层（`.mask` + `.sheet` + ✕ + 取消/保存），保存直接回写 `costs[i].note`，人不动地方
>   - **附件不再单独罗列**：原来附件自成一个 `sec-title` + 独立卡片，**没附件时还显示一大段说明**。改成并入上面那张信息卡（`kv col`，缩略图 + `待传` 小标 + 重试链接都在卡内），**没附件就整块不显示**
>   - 数据口径不变：备注改动仍走 `store.costs.save()`（写 `updatedAt` + outbox + 留痕），`store.js` 的 `save()` 补了一条 `改备注` 留痕分支（原来改金额/分类/日期之外的改动不留痕）。留痕只写数据、界面不展示（沿用 0.7.5 口径）
>   - 自检：`node --test miniprogram/tests/*.test.js` → 51/51；`node scripts/check-miniprogram.js` → 25 页 + keypad 全通过；设计稿 F8 mock 同步（附件并入信息卡、无附件不显示、分摊行不缩进、备注就地编辑），`div` 开合平衡、仍是 28 屏
>   - 模拟器真机路径复核：`.link` 点开备注层（不跳页）→ 输入 → `.sheet .btn.ghost ~ .btn` 点保存 → 本地库 `note` 落地且 `audit` 出现 `改备注`；另给该笔临时塞 2 张附件复核卡内布局（`docs/design/verify/cost-detail-att.jpg`），验完已把本地库与云端恢复原状（`note=""`、无附件）
>   - **上传记录**：2026-10-06 `upload --upload-version 0.7.6`，代码包 522,885 B（TOTAL 1 个包），`taskId=confirmation_upload_bc97d399…` → `execution_success`
> - **2026-10-06：体验版 `0.7.7` 已上传**（周期账日期口径 / 记一笔拆 chip / 连续补账并入记一笔，二维码同 `docs/trial-qr-0.7.0.png`，无需换码）
>   - **周期账的每季/每年原来只让选「几号」**，锚月写死在 1 月 → 等于没得选。改成按频率换行：每周=周几、每月=几号、**每季=哪个月+几号（每 3 个月一次，从选的月份起算）**、每年=哪个月+几号；「几号」改成 1–31 的完整选择器；选完当场回显口径（如「每 3 个月一次 · 1 / 4 / 7 / 10 月的 1 号」）+「下次提醒：2027年1月1日 周五」。`store.recurring.dueOn` 加 `month` 锚月（老数据没 `month` 就按起点月，行为不变），新增 `recurring.nextOn`；月/季/年的「几号」都按实际月份天数收敛（选 31 号落到 2 月就是 28/29 号）
>   - **记一笔把挤成一行的 8 个 chip 拆开内嵌到整页**（原来 日期/分摊/备注/附件/周期/赊账/账户/常用账 全挤在键盘上面两行里）：时间相关（日期 / 周期）搬到最上面；「归到哪个种植季」贴到分类名右边（点开=分摊）；「常记的账 ＋ ★常用账」合成一行放在分类区顶部；备注与附件并成一栏放在分类宫格下面（就地写/就地看，不再跳弹层）；账户与赊账（钱怎么走的）留在键盘上方一条
>   - 顺带修掉一个真 bug：`cost-edit.js` 的 `modes` 从来没被赋值，**「怎么算」那一行（直接填 / 按亩计 / 按人天 / 按斤×价 / 按亩×价）一直是空的**，用户根本切不了算法。现在按方向正确填充（支出 3 个、收入 3 个）
>   - **连续补账不再是另一套表单**：删掉 `pages/catchup`，改成**记一笔的补账模式**（`cost-edit?batch=1`）——顶上加「第 N / M 天 + 进度条 + ‹ 日期 ›」，其余录入区与记一笔完全一致（分类宫格、按亩计/按人天、分摊、备注、附件、账户、赊账、常用账全都有），键盘右下角变「保存并下一天」。原来那个多余的「常用」模块随之消失。两个入口（账本页、季详情）改指向新地址
>   - 另：分类宫格改一行 5 个（原来一行 4 个，第二行被切一半）；大类分段改自动换行（原来 5 个挤一行，「固定资产」被切掉）；键盘行高 108→100rpx；键盘 OK 键长文案自动缩字号（「保存并下一天」不再撑出格子）
>   - 设计稿同步：F1 记一笔 mock 按新布局重画并重写说明、F4 周期账改成「每季/每年 = 哪个月 + 几号」并加口径回显、F11 连续补账改成「记一笔的补账模式」、覆盖清单 P1-8 与口径表同步；仍是 28 屏、`div` 开合平衡
>   - 自检：`node --test miniprogram/tests/*.test.js` → 51/51（周期账用例补了「季=每 3 个月、锚月可指定」「年=哪个月」「nextOn 下次提醒」，并修掉一条写死日期的倒计时用例）；`node scripts/check-miniprogram.js` → 24 页 + keypad 全通过
>   - **上传记录**：2026-10-06 `upload --upload-version 0.7.7`，代码包 524,603 B（TOTAL 1 个包），`taskId=confirmation_upload_39b59d9b…` → `execution_success`
>   - 模拟器真机路径复核：`.k` 在自定义组件里选不到，所以金额用页面事件驱动，**保存走的是真实 `save()` 分支**——补账模式记 2026-10-06 后本地库出现 `date=2026-10-06 / src=catchup`，并自动跳到下一天（8 天进度：第 1/8 天 → 存 9-24 → 进度变 1/7、日期跳到 9-25）；截图存 `docs/design/verify/cost-edit.jpg`、`cost-edit-in.jpg`、`cost-edit-rec.jpg`、`cost-edit-rec-year.jpg`、`cost-edit-batch.jpg`、`recurring-edit.jpg`；**验证用的 2 笔假账已从本地库和云端一起清掉**（云端 costs 计数回到 6）
> - 小程序名已变更为 **田祖记**（原名 Londdon123kkk，改名审核已生效）
> - **2026-10-01：体验版 `0.5.0` 已上传**（参谋问答全面切换大模型多智能体：新增云函数 `advisorAgent`（DeepSeek 原生 tool-calling loop，9 个只读工具按 openid 隔离 + draft_* 起草工具，写操作必须农户确认才落库）；`chat.js` 重写，删除全部本地对话规则与 `nlu.js`，失败只诚实报错；模型简化为 deepseek-flash / deepseek-v4-pro（BYOK，Key 只存云端）。**注意：CLI/IDE 部署不会应用 config.json 的 timeout**，advisorAgent 60s / advisorChat 30s 是走 `/tcb/getqcloudtoken` 换腾讯云凭证后直调 SCF `UpdateFunctionConfiguration` 改的；实测数据问/农技问/天气问/起草/多轮/客户端 send 全链路通过）
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
