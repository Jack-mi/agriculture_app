# 农事参谋知识库（kb/）

可插拔数据层：**知识全在这 5 个数据文件里，逻辑在 `utils/`**。要调整知识，只改这里的文件，不动任何代码。

## 文件与结构

| 文件 | 内容 | 条目结构 |
|---|---|---|
| `docs.js` | 技术意见库（按作物×阶段） | `{ key: { title, org, year, crops:[], stages:[], tags:[], excerpt } }` |
| `pesticides.js` | 农药登记表 | `[{ name, form, crops:[], target, rate:[低,高], unit, times, note? }]` |
| `blocked.js` | 限用/禁用/高风险药剂 | `[{ name, reason }]` |
| `stages.js` | 生育期积温阈值 + 品种熟期系数 + 积温口径 | 见文件头注释 |
| `index.js` | 汇总导出（勿改结构，只加引用） | — |

## 字段约定

- `crops`：`['wheat']` / `['corn']`（作物 key，对应 `utils/const.js` 的 CROPS）
- `stages`：生育期 key（`stages.js` 里的 key），空数组 = 全周期通用
- `tags`：自由关键词（`除草`/`浇水`/`追肥`/`收获`…），供后续按问题定向注入
- `rate`：登记用量区间，`unit` 单位必须和登记一致；`times` 每季最多次数
- 数据口径：**以官方公开文件/登记信息为准，产品标签优先于本库**；条目里标了年份的按年份复核

## 调整方式

- 加技术意见：在 `docs.js` 加一个 key（key 会被任务卡片的「依据」引用，别改老 key）
- 加/改农药：改 `pesticides.js`；剂量写登记区间，拿不准的别收进来
- 限用名单：`blocked.js`，参谋推荐时会避开、农户记录时会提醒
- 标定生育期阈值/品种系数：改 `stages.js`，改完跑 `node --test miniprogram/tests/`

## 复核节奏

- 每年 3 月（春季管理前）复核春季类条目，9 月（播种前）复核播种/冬前类条目
- 农药登记信息来源：中国农药信息网（ICAMA）公开查询，每年复核一次
