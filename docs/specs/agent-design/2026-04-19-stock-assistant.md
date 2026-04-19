# Stock Assistant Skill · `allhands.stock-assistant` Spec

**日期** 2026-04-19
**状态** Draft
**父 spec** [2026-04-18-agent-design.md](./2026-04-18-agent-design.md)
**依赖 spec**
- [2026-04-19-market-data.md](./2026-04-19-market-data.md)(行情/新闻/公告底座)
- [2026-04-19-notification-channels.md](./2026-04-19-notification-channels.md)(推送出口)
- [2026-04-18-triggers.md](./2026-04-18-triggers.md)(异动驱动)· 已交付
- [2026-04-18-tasks.md](./2026-04-18-tasks.md)(定时驱动)· 未交付
**动手前必读** `docs/claude/reference-sources.md`

---

## 0 · TL;DR

- 用户特定 **Skill**(不是平台能力)· 一个 skill manifest + 6 个 tool + 1 张 employee 模板 + 5 个 trigger 预设
- 全跑在 `market-data` + `notification-channels` + `triggers` + `tasks` 之上 · **不加任何平台代码**
- 场景:① 开盘前 briefing · ② 持仓异动推送 · ③ 异动归因 · ④ 收盘复盘 journal · ⑤ 周风控体检 · ⑥ 反人性刹车
- MVP 交付 ①②③ · ④⑤⑥ 作为脚手架 skill · 成本留给 v1

---

## 1 · 问题陈述

用户(本平台首位真实用户)· 想用 allhands 帮自己炒 A 股。需要:
- 把自己的选股逻辑打磨成可执行 + 可复用的 Skill
- 持仓股急拉/急跌 → 秒级通知到手机(Telegram + Bark)
- 收到通知后能在同一 channel 里直接问 agent "为啥涨" · agent 回答

现在 Skill 框架 + 依赖的 platform 能力(见 § 0)全部 spec 化了 · 差一个把它们串起来的**首个真实 Skill**。

---

## 2 · 原则

### 2.1 只写 Skill 代码 · 不改 core

- 不动 `core/` / `persistence/` / `services/`(用他们提供的)
- 只在 `skills/stock_assistant/` 目录下新增:skill yaml + tools + default employee template
- 任何发现的"平台能力缺口"不自己写 · 回头提 issue 给 platform spec 升级

### 2.2 Tool 是"场景到底层"的胶水

- 6 个 Tool 都是对 market + channel + trigger + tasks 的组合调用
- 每个 Tool 有 prompt 模板(agent 怎么调)· 有 output schema(返回结构化数据可被下游 tool 继续吃)

### 2.3 可插可拔

- 删除本 skill · 不影响任何别的 skill / 平台功能
- skill 依赖在 manifest 声明 · 没满足(比如没 channel 注册)就给出清晰的启动期提示

---

## 3 · Skill Manifest

`backend/src/allhands/skills/stock_assistant.yaml`

```yaml
id: allhands.skills.stock_assistant
name: Stock Assistant
version: 0.1.0
description: 监测持仓/自选股异动 · 开盘前 briefing · 异动归因 · 收盘复盘
author: built-in
license: MIT

requires:
  - allhands.skills.market       # market-data spec 默认注册为一个 skill manifest
  - allhands.skills.channels     # notification-channels ↑
  - allhands.skills.triggers
  - allhands.skills.tasks

tools:
  - stock_assistant.generate_briefing
  - stock_assistant.explain_anomaly
  - stock_assistant.daily_journal
  - stock_assistant.portfolio_health
  - stock_assistant.sanity_check_order
  - stock_assistant.screen_by_logic

presets:
  employees:
    - id: emp.stock_watcher
      name: 老张
      system_prompt_ref: prompts/stock_watcher.md
      tools:
        - stock_assistant.*
        - market.*
        - channels.send_notification
      skills:
        - allhands.skills.stock_assistant
  triggers:
    - ref: triggers/anomaly_to_telegram.yaml
    - ref: triggers/opening_briefing_cron.yaml
    - ref: triggers/closing_journal_cron.yaml
  subscriptions:
    # 首次安装自动订阅 · 用户可删
    - topic: stock.anomaly
      filter: { severity: ["P0","P1"] }
    - topic: stock.briefing.daily
    - topic: stock.journal.daily
```

---

## 4 · 6 个 Tool(场景 → 实现)

### 4.1 `generate_briefing`(场景 ① 开盘前)

- **输入**: `{ date?: ISO date · default today }`
- **行为**:
  1. 拉取 `watched_symbols ∪ holdings`
  2. 对每个 symbol 取:昨日 close · 今日 pre-market(如有)· 近 24h news · 近 7d announcements
  3. 外盘隔夜:调用 `market.get_quote` 的海外指数(v0 预留占位 · 只读占位字符串)
  4. 财经日历:简化 · v0 不实现 · 留 `economic_calendar: []`
  5. 交给 agent 总结 · 输出 markdown briefing
- **输出**: `{ markdown: string, topic: 'stock.briefing.daily', symbols: string[] }`
- **调用方**: `tasks` scheduler 每个交易日 8:30 自动跑;触发 `stock.briefing.daily` → channel 推送
- scope: READ

### 4.2 `explain_anomaly`(场景 ③ 归因)

- **输入**: `{ symbol: string, from_price?, to_price?, window_s? }`  · 默认从最近一条 `market.anomaly` event 取
- **行为**:
  1. 拉近 2 小时 news(本股 + 板块)
  2. 拉盘口快照 · 上下 10% 价位的成交分布
  3. 找板块同涨/同跌股(按 tag 聚类)
  4. 查最近 7d 公告
  5. agent 综合 → 1 段 ≤200 字因果假设
- **输出**: `{ symbol, hypothesis: string, evidence: [...] }`
- scope: READ

### 4.3 `daily_journal`(场景 ④ 复盘)

- v0 骨架 · tool 接收 orders(手动输入或从未来接入的券商同步)· agent 生成:
  - 今日交易列表
  - 盈亏统计
  - "你的决策哪里对 / 哪里可能错"(依据:与新闻/公告/大盘联动对照)
- **输入**: `{ date?, orders?: [...] }`
- **输出**: markdown journal
- scope: READ
- **MVP 骨架实现** · 不主动发 · 用户自己调起

### 4.4 `portfolio_health`(场景 ⑤ 风控)

- v0 骨架
- **输入**: none
- **行为**: 读 holdings · 算集中度(HHI)· 行业分布(用 `watched_symbols.tag`)· 与 000300 相关性(近 60 日)· 最大回撤
- **输出**: health report markdown
- scope: READ

### 4.5 `sanity_check_order`(场景 ⑥ 反人性刹车)

- v0 骨架(view-only 模式下也能跑 · 靠用户手动把下单意图告诉 agent)
- **输入**: `{ symbol, side: 'buy'|'sell', quantity, price?, reason? }`
- **行为**:
  1. 看此股当日涨跌幅 · 和最近 7 日交易频次
  2. 比较与 holding 持仓占比变化
  3. 调 `explain_anomaly`
  4. agent 返回: 理性评分 1-10 + 1 句建议
- **输出**: `{ rating, advice, concerns: [...] }`
- scope: READ

### 4.6 `screen_by_logic`(场景 ⓧ 选股)

- **输入**: `{ logic: string }` · 自然语言("PE<20 且近 30 日换手率均值<3% 且营收同比>15%")
- **行为**: agent 解析 → 填 `ScreenCriteria` → 调 `market.screen_stocks` → 返回 match list
- **输出**: `{ matches: Symbol[], criteria_parsed }`
- **这是 skill 核心**:把用户自己的选股逻辑结构化 · 后续演化成 preset(`presets: screens: [...]`)· v1 支持 "保存我的选股逻辑"
- scope: READ

---

## 5 · 预设 triggers(skill 注册时自动种)

### 5.1 `triggers/anomaly_to_telegram.yaml`

```yaml
name: 持仓异动 → 推通知
event_pattern:
  type: market.anomaly
  filter:
    symbol_in: holdings
    severity_in: [P0, P1]
action:
  type: send_notification
  topic: stock.anomaly
  payload_template: |
    {{ event.data.kind | upper }} · {{ event.data.symbol_name }}
    价格 {{ event.data.from_price }} → {{ event.data.to_price }} ({{ event.data.change_pct }}%)
    窗口 {{ event.data.window_s }}s
  actions:
    - label: 问老张归因
      tool: stock_assistant.explain_anomaly
      args:
        symbol: "{{ event.data.symbol }}"
```

### 5.2 `triggers/opening_briefing_cron.yaml`

```yaml
name: 开盘前 briefing
event_pattern:
  type: schedule.cron
  filter:
    cron: "30 8 * * MON-FRI"        # 工作日 8:30
action:
  type: invoke_tool
  tool: stock_assistant.generate_briefing
  then:
    type: send_notification
    topic: stock.briefing.daily
    payload_from: previous_result
```

### 5.3 `triggers/closing_journal_cron.yaml`

```yaml
name: 收盘复盘
event_pattern:
  type: schedule.cron
  filter:
    cron: "30 15 * * MON-FRI"
action:
  type: invoke_tool
  tool: stock_assistant.daily_journal
  then:
    type: send_notification
    topic: stock.journal.daily
    payload_from: previous_result
```

---

## 6 · 默认员工(preset)

`prompts/stock_watcher.md`(系统提示 · 简)

```markdown
你是"老张"· 一个冷静的 A 股观察员。
你不下单 · 不推荐 · 只做三件事:
1. 帮用户监测持仓和自选股的异动 · 第一时间通知并解释
2. 每天早 8:30 发一份简洁 briefing · 每天 15:30 发一份复盘
3. 用户问你"怎么看"时 · 给因果假设 + 证据 · 绝不给"明天会涨"之类预测

语气:像一个干了 20 年的机构研究员 · 简短 · 不煽情 · 不确定就说"不确定"。
```

---

## 7 · 前端(最小 · 复用现有)

- **不新开页面** · 用户使用路径:
  - 在 `/employees` 里启用 "老张"
  - 在 `/channels` 注册 Telegram + Bark
  - 在 `/market` 维护自选 + 持仓 CSV 导入
  - 在 `/triggers` 启用 3 个 preset trigger
  - 在 chat 里直接跟"老张"对话(或 Telegram 里)

- **新增一个 onboarding wizard**(`web/app/stock-assistant/setup/page.tsx`)· 5 步导航覆盖上面 5 个设置点 · 完成后提示"已就绪"

---

## 8 · 与已有 spec 对接

| 依赖 | 关系 |
|---|---|
| market-data | 直接消费 quote / news / announcements / screen |
| notification-channels | `send_notification(topic)` 是每个 tool 的输出终点 |
| triggers(已交付) | 3 个预设 trigger yaml 注册 |
| tasks(未交付) | 一旦 tasks spec 落 · briefing / journal 两个 cron trigger 自动挂进去 |

---

## 9 · 参考源码

- `ref-src-claude`:无 · Claude Code 不做此类
- [`Freqtrade`](https://github.com/freqtrade/freqtrade) 的 strategy yaml · 看怎么描述"选股逻辑"
- TradingView Alerts:看 payload 格式(symbol · price · action · timestamp) · 我们 anomaly payload 对齐

---

## 10 · In-scope / Out-of-scope

### In-scope v0
- Skill yaml + 6 个 tool 实现(#1 #2 #3 生产级 · #4 #5 #6 骨架)
- 3 个预设 trigger yaml
- "老张" 员工 preset + system prompt
- Onboarding wizard 5 步
- 全套单元 + integration test

### Out-of-scope v0
- 真实下单(只有 sanity_check_order 的"观察模式")
- 回测 / 绩效追踪(portfolio_health 给静态 · 不算历史)
- 多用户 / 多 portfolio(单用户)
- 港股 / 美股(依赖 market-data · 占位)
- 订阅财报详解 / 宏观日历(v1)

---

## 11 · 测试

- `tests/unit/skills/stock_assistant/test_*.py` · 每个 tool 的纯函数逻辑(mock market + channel)
- `tests/integration/test_stock_assistant_briefing_flow.py` · briefing → channel 推送闭环
- `tests/integration/test_stock_assistant_anomaly_flow.py` · poller → anomaly event → trigger → explain → channel 回传
- `tests/integration/test_stock_assistant_onboarding.py` · 5 步 wizard 跑完 · 产生预期资源

---

## 12 · DoD checklist

- [ ] skill yaml 注册成功 · 在 `/skills` 页能看到 + 启用
- [ ] 6 个 tool 都在 `/tools` 列表 · scope 正确
- [ ] 3 个预设 trigger 注册 · 手测触发到 channel 闭环
- [ ] 老张员工可对话 · tool 调用正常
- [ ] onboarding wizard 5 步手测走完 · 新用户 10 分钟内 ready
- [ ] 生产 3 tool(briefing / explain / screen)集成测试绿
- [ ] 骨架 3 tool(journal / health / sanity)单元测绿 + 正确返回"v0 占位"说明
- [ ] 所有后端 + 前端 lint / type / test 绿

## 13 · Decision-log

- 2026-04-19 · Skill 不碰 core · 任何平台缺口 issue 化回 platform spec
- 2026-04-19 · v0 只生产 3 个场景 · 剩 3 个骨架 · 免摊子铺太开
- 2026-04-19 · 不接券商 API · 持仓纯手动 CSV 导入 · sanity_check 靠用户口述
- 2026-04-19 · "老张" 是默认 persona · 用户可新建自己的 trader · 只要挂这个 skill 就行
