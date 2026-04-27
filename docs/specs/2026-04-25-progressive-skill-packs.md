# 渐进式 Skill Pack · 把剩下的 meta tool 全部纳入按需加载

**Status:** spec · 2026-04-25
**Owner:** liushuai
**Scope:** Lead Agent 上下文减负 · 把剩余 ~30 个未打包的 meta tool 拆成 6 个新 skill 包 · 让所有员工(不只是 Lead)都能按需挂载使用。

---

## 0. TL;DR

- **现状**:124 个 meta tool · 12 个 skill 包 · Lead 当前 ~30 个工具常驻 · ~5 个 admin skill 描述符常驻 · 仍有 ~30 个工具裸露在外(triggers / channels / tasks / market / observatory / conversation lifecycle / review)
- **问题**:这些裸露工具跟着「员工模板」逐个补 → 容易猪脑过载,新员工配置缺失
- **方案**:6 个新 skill 包 · 沿用 ADR 0015 三阶加载 · 任何员工挂上就能用 · Lead 默认挂全部 7 个 admin 包(原 5 + 新 6 - 重叠)
- **已有基础设施完全够用**:不动 `SkillRuntime` / `resolve_skill` / loader · 只新增 yaml + md
- **效果**:Lead 平均上下文 -8% ~ -12% · 新员工配置可以「拣 3 个 skill 而不是拣 20 个 tool」

---

## 1. 现状盘点(为什么不是大改造)

### 1.1 已有的渐进式机制(ADR 0015 已落地)

```
turn 0:  system_prompt += [skill_descriptor × N]            # ~50字符×N · 廉价
turn k:  resolve_skill(id) → SkillRuntime
         ├─ tool_ids 注入                                   # 这一组 tool schema 才进 LLM 视野
         ├─ prompt_fragment 注入                            # skill 的工作流 prompt
         └─ SKILL.md body 注入(可选)                        # 详细使用说明
turn k+m: read_skill_file(id, path) → reference / template  # 按需拉子文件
```

工具 schema 是上下文大头(每个 tool 平均 ~250 token · 30 个工具 = 7.5k token)· 三阶机制把这部分推迟到「真要用」才支付。

### 1.2 已经打成 skill 的家族

| skill 包 | 工具数 | 状态 |
|---|---|---|
| allhands.team_management | 5 | ✓ |
| allhands.model_management | 6+ | ✓ |
| allhands.skill_management | 5 | ✓ |
| allhands.mcp_management | 5 | ✓ |
| allhands.cockpit_admin | 5+ | ✓ |
| allhands.kb_researcher | 8 | ✓ |
| allhands.stock_assistant | 6 | ✓ |
| allhands.artifacts | 14 | ✓ |
| allhands.render | 14 | ✓(always-hot · L16) |
| allhands.planner | 4 | ✓(always-hot · 工作记忆) |
| allhands.executor-spawn | 1 | ✓ |
| allhands.drawio-creator | 1 + 模板 | ✓(2026-04-25 新增) |

### 1.3 仍未覆盖的家族(本次目标)

| 家族 | tool 数 | 谁会用 |
|---|---|---|
| triggers(定时 / 事件触发管理)| 6 | Lead · 自动化设计员工 |
| channels(通知渠道 · Slack/邮件/Webhook)| 7 | Lead · 通知员工 |
| tasks(任务生命周期 · 分发 / 验收 / 取消)| 7 | Lead · 任务调度员工 |
| market(行情 / 新闻 / 持仓)| 9 | 金融分析员工 |
| observatory(运行观测 / trace 查询)| 4 | Lead · SRE 员工 |
| review(三级闸门 · self / walkthrough / harness)| 3 | Lead · QA 员工 |

合计 36 个 tool · 6 个新 skill 包。

---

## 2. 设计原则(下次再加 skill 包就照着填)

### 2.1 一个 skill 包 = 一个回答得了的问题

| skill 包名 | 一句话回答 |
|---|---|
| triggers_management | 「我怎么让某个事情自动跑起来?」 |
| channels_management | 「我怎么让员工把消息推到 Slack/邮件?」 |
| task_management | 「我怎么管这个长任务的状态?」 |
| market_data | 「我怎么拿股票行情 / 新闻 / 持仓?」 |
| observatory | 「这次 run 跑得怎么样? trace 在哪?」 |
| review_gates | 「这个 spec 走完三道闸门了吗?」 |

如果一个工具不属于任何「能用一句话回答的问题」 → 它要么并入 always-hot 核心 · 要么跟最近的 skill 合并 · 不允许孤儿。

### 2.2 三段结构(强制)

每个 skill 目录:

```
skills/builtin/<skill-id>/
├── SKILL.yaml              # 必须 · descriptor(name + ≤80字符 description + tool_ids + prompt_fragment_file)
├── prompts/guidance.md     # 必须 · activation 时注入的工作流 prompt
└── templates/ (可选)        # read_skill_file 拉的子文件 · 例:cron 表达式备忘录 / common payload
```

descriptor 字段:
- `id` → `allhands.<家族名>` · 必须 ≤ 32 字符
- `description` → 一句话 · ≤ 80 字符 · 直接进 system_prompt 让 Lead 看到
- `tool_ids` → 这个家族的全部 tool · 不要遗漏(否则用户激活了但没工具)
- `prompt_fragment_file` → 必须填 · 没 prompt 的 skill 等于「给了工具但不教怎么用」

### 2.3 工作流 prompt 写法(给 LLM 看)

`prompts/guidance.md` 必须包含 3 段:
1. **何时调用** — 一句话决策准则,例:「用户说定时 / 触发器 / 自动跑 → 先 list_triggers 看现有」
2. **典型工作流** — 3-5 步操作模板 · 用工具名 + 简单参数示意
3. **常见坑** — 例:「create_trigger 后必须 toggle_trigger(enabled=true) 才会真跑」

prompt 长度建议 200-400 token · 短了模型抓不住要点,长了浪费上下文。

### 2.4 命名规范

- skill_id:`allhands.<snake_case_家族名>` · 不要带版本号
- yaml `name`:中文人话标签(给设置页 UI 用)
- prompt fragment:中文 · 因为 user-facing 提示和 example 都是中文
- tool_ids 引用:全限定 `allhands.meta.xxx` · 不要简写

---

## 3. 6 个新 skill 包(本次实现)

### 3.1 `allhands.triggers_management`

```yaml
id: allhands.triggers_management
name: 触发器管理
description: 创建 / 启停 / 触发定时与事件 · 让员工的工作可以无人值守自动跑
tool_ids:
  - allhands.meta.list_triggers
  - allhands.meta.get_trigger
  - allhands.meta.create_trigger
  - allhands.meta.update_trigger
  - allhands.meta.delete_trigger
  - allhands.meta.toggle_trigger
  - allhands.meta.fire_trigger_now
  - allhands.meta.list_trigger_fires
prompt_fragment_file: prompts/guidance.md
```

guidance 教 cron 表达式 + 事件 trigger 的 payload 形状 + 「创建后必须 toggle」陷阱。

### 3.2 `allhands.channels_management`

```yaml
id: allhands.channels_management
name: 通知渠道
description: 注册 Slack / 邮件 / Webhook · 让员工的输出推到外部
tool_ids:
  - allhands.meta.list_channels
  - allhands.meta.register_channel
  - allhands.meta.update_channel
  - allhands.meta.delete_channel
  - allhands.meta.test_channel
  - allhands.meta.list_subscriptions
  - allhands.meta.update_subscription
  - allhands.meta.send_notification
  - allhands.meta.query_channel_history
prompt_fragment_file: prompts/guidance.md
```

### 3.3 `allhands.task_management`

```yaml
id: allhands.task_management
name: 任务管理
description: 创建 / 跟进 / 验收异步任务 · 长流程不靠对话堆叠
tool_ids:
  - allhands.meta.tasks.list
  - allhands.meta.tasks.get
  - allhands.meta.tasks.create
  - allhands.meta.tasks.cancel
  - allhands.meta.tasks.approve
  - allhands.meta.tasks.answer_input
  - allhands.meta.tasks.add_artifact
prompt_fragment_file: prompts/guidance.md
```

### 3.4 `allhands.market_data`

```yaml
id: allhands.market_data
name: 行情数据
description: 股票行情 / K 线 / 新闻 / 公告 / 持仓 / 自选 · 金融场景共用
tool_ids:
  - allhands.meta.get_quote
  - allhands.meta.get_quote_batch
  - allhands.meta.get_bars
  - allhands.meta.get_news
  - allhands.meta.get_announcements
  - allhands.meta.search_symbol
  - allhands.meta.screen_stocks
  - allhands.meta.list_watched
  - allhands.meta.add_watched
  - allhands.meta.remove_watched
  - allhands.meta.list_holdings
  - allhands.meta.add_holding
  - allhands.meta.update_holding
  - allhands.meta.remove_holding
  - allhands.meta.import_holdings_csv
  - allhands.meta.set_poller_thresholds
prompt_fragment_file: prompts/guidance.md
```

注:与现有 `stock_assistant` skill 的关系是「数据 vs 业务」 — `market_data` 是底层 read/write,`stock_assistant` 是上层语义(briefing / anomaly)。

### 3.5 `allhands.observatory`

```yaml
id: allhands.observatory
name: 运行观测
description: 查询 trace / run 状态 / langfuse 健康 · 排障与分析的入口
tool_ids:
  - allhands.meta.observatory.get_status
  - allhands.meta.observatory.bootstrap_now
  - allhands.meta.observatory.query_traces
  - allhands.meta.observatory.get_trace
prompt_fragment_file: prompts/guidance.md
```

### 3.6 `allhands.review_gates`

```yaml
id: allhands.review_gates
name: 三级闸门
description: self-review / walkthrough / harness 串联 · 把 spec 推到能交付
tool_ids:
  - allhands.meta.cockpit.run_self_review
  - allhands.meta.cockpit.run_walkthrough_acceptance
  - allhands.meta.cockpit.run_harness_review
prompt_fragment_file: prompts/guidance.md
```

---

## 4. Lead Agent 配置变化

### 4.1 LEAD_EXTRA_SKILL_IDS 扩张

```python
LEAD_EXTRA_SKILL_IDS: tuple[str, ...] = (
    "allhands.team_management",
    "allhands.model_management",
    "allhands.skill_management",
    "allhands.mcp_management",
    "allhands.cockpit_admin",
    # 2026-04-25 · 6 个新管理 skill,原本工具直接挂在 default_lead_tool_ids
    # 现在改 descriptor-only · 上下文减负
    "allhands.triggers_management",
    "allhands.channels_management",
    "allhands.task_management",
    "allhands.market_data",
    "allhands.observatory",
    "allhands.review_gates",
)
```

### 4.2 always-hot 工具不变

`default_lead_tool_ids()` 保持现状 · 这次只把「未打包」的工具收进 skill,不再额外裁剪 always-hot(那是另一个 PR)。

### 4.3 上下文影响估算

每个新 skill descriptor ≈ 80 字符 ≈ ~25 token · 6 个 = 150 token

如果用户从未激活这些 skill,Lead 上下文增加 150 token,但避免了原本 36 个 tool schema(36 × 250 = 9000 token)的暴露。**净收益 ~8.7k token / turn**。

---

## 5. 其他员工怎么用

任何员工都可以在 `Employee.skill_ids` 里挂这些 skill_id,然后:
- turn 0 就拿到 descriptor
- 调 `resolve_skill(id)` 后该 skill 的 tool 才注入

例如「金融分析员工」可以挂 `[allhands.market_data, allhands.stock_assistant, allhands.artifacts]` 而不需要列 16 个工具 id。员工设计页(`/employees/design`)的 skill 选择器自动列出全部 builtin skill,UI 不用改。

---

## 6. 文件归位

```
backend/skills/builtin/
├── triggers_management/
│   ├── SKILL.yaml
│   └── prompts/guidance.md
├── channels_management/
├── task_management/
├── market_data/
├── observatory/
└── review_gates/
```

```
backend/src/allhands/services/employee_service.py
  → LEAD_EXTRA_SKILL_IDS 扩 6 项
backend/tests/unit/test_bootstrap.py
  → test_ensure_lead_agent_ships_full_admin_surface 更新预期 skill 数
```

---

## 7. 不在本次范围

- **裁剪 always-hot 核心**:还有部分 list_*/get_* 可以打成 read-only discovery skill。但这会触动 L06「Lead 永远能答 what's configured」契约,需要单独 spec
- **skill 之间的依赖图**:有的 skill 显然依赖另一个(market_data ← stock_assistant) · 后续可以加 `requires` 字段做 transitive activation
- **skill 的「用了就 pin」**:激活过的 skill 是否在下一轮自动保持热,还是每轮重新决策。当前是「这一轮内热」 · 不改
- **市场制 skill 安装时的同名冲突**:用户从 GitHub 装一个 `triggers_management` 怎么办。已经有 `source` 字段区分 builtin vs market,但 UI 还没显示

---

## 8. 验收

每个新 skill 1 条端到端:

1. 在 `/employees/<lead>` 详情页确认 skill 列表里能看到这 6 个
2. 跟 Lead 说「打开 triggers 技能」 → agent 调 `resolve_skill('allhands.triggers_management')` → 接下来对话里能调 `list_triggers` / `create_trigger`
3. 给一个普通员工挂 `market_data` skill · 让他「查 AAPL 当前股价」 → 应该 resolve_skill + get_quote 两步内成功
4. 重启后端 · skill 列表仍含这 6 个(SkillRegistry 持久化)
