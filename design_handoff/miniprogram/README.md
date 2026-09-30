# 谷雨记 · 微信小程序

种粮大户的农田电子账本：地块 × 作物 × 种植季，记账（5 类成本）+ 记事（每日农事 / 气温 / 降雨 / 墒情），自动统计积温与降雨。

## 快速运行
1. 打开「微信开发者工具」→ 导入项目 → 选择本 `miniprogram/` 目录。
2. AppID：测试可用「测试号」；正式发布请把 `project.config.json` 里的 `appid` 换成你的。
3. 开发者工具中勾选「不校验合法域名」即可直接拉天气调试。

## 上线前必做
| 事项 | 位置 |
|---|---|
| request 合法域名：`https://api.open-meteo.com`、`https://archive-api.open-meteo.com` | 小程序后台 → 开发管理 → 开发设置 |
| 位置接口权限：`wx.chooseLocation` / `wx.getLocation` | 小程序后台 → 开发管理 → 接口设置（需说明用途：自动获取地块天气） |
| 用户隐私保护指引：声明"位置信息"用途 | 小程序后台 → 设置 → 服务内容声明 |
| （可选）云备份：开通云开发，把环境 ID 填到 `app.js` 的 `CLOUD_ENV`，建集合 `guyuji_userdata`（权限：仅创建者可读写） | 云开发控制台 |

## 目录
```
app.js / app.json / app.wxss     入口、路由、全局样式（大字号高对比）
utils/const.js                   作物、5 类成本、农事操作（加作物只改这里）
utils/store.js                   本地离线数据仓库（先写本地 = 弱网兜底）
utils/weather.js                 Open-Meteo：近30天用 forecast，更早用 archive；手工修正永不覆盖
utils/stats.js                   成本汇总、积温（逐日均温累计）、降雨累计
utils/sync.js                    可选云端备份，联网自动同步，openid 天然隔离
pages/index                      今天：在种各季卡片 + 两个大按钮直达记账/记事
pages/plots                      地块列表 + 往季
pages/plot-edit                  地块：名称 / 亩数 / 地图选点
pages/season-new                 开季：地块 / 作物 / 播种日 / 播种量(斤/亩) / 整地
pages/season                     季详情：账本 / 记事 / 天气(逐日+累计，可修正) / 信息
pages/cost-edit                  记账：5 类 + 细分；雇工 = 人数×日工价
pages/log-edit                   记事：多选农事 + 施肥品类/用量 + 墒情；"保存并记花费"一键关联
pages/harvest                    收获：产量、亩产、全周期积温/降雨/成本、每斤成本
pages/mine                       统计、导出为文字、分享
```

## 口径
- 积温 = 播种日到收获日（在种则到今天）每日平均气温之和（含负值，同时展示仅 0℃ 以上的值）。
- 固定资产（机械、土地流转）计入当季总成本。
- 冬小麦跨年：季以播种日为起点，天数/积温/降雨跨年连续累计，标签显示"2026–2027 小麦"。
