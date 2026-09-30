# 谷雨记 · 种粮大户的农田电子账本

微信小程序（唯一形态）+ 微信云开发后台。离线优先：本地先写，联网后分集合逐条同步；
`wx.login` openid 静默建档，零注册；天气由云函数统一拉取（Open-Meteo，免 Key）。

## 目录

```
miniprogram/      小程序前端（原生 WXML/WXSS/JS，设计已定稿，UI 不改动）
cloudfunctions/   login（建档）/ weatherDaily（每日定时拉天气）/ weatherBackfill（回补）
docs/deploy.md    部署文档：AppID、云环境、集合、云函数、隐私配置、验收 checklist
design_handoff/   设计交付留档（高保真原型 + 说明）
PRD.md / MVP-PRD.md
```

## 快速开始

1. 按 `docs/deploy.md` 完成前置（真实 AppID + 开通云开发 + 建集合 + 部署云函数）。
2. 微信开发者工具导入本目录（根 `project.config.json` 已配 `miniprogramRoot` / `cloudfunctionRoot`）。
3. `miniprogram/app.js` 填入云环境 ID 后即完成接入。
