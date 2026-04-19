# Harness 自审 Spec · 执行端定期 audit 自己的协作工具链

**日期** 2026-04-18
**状态** Draft
**父 spec** [2026-04-18-agent-design.md](./2026-04-18-agent-design.md)
**补充关系** [self-review spec](./2026-04-18-self-review.md)(产品自审)和本 spec(工具链自审)是**两条并列**的反思循环 —— 前者面向**产品**,后者面向**做产品的工具链**
**动手前必读** [`docs/claude/working-protocol.md`](../../claude/working-protocol.md) · [`docs/claude/learnings.md`](../../claude/learnings.md) · [`docs/claude/error-patterns.md`](../../claude/error-patterns.md) · [`docs/claude/reference-sources.md`](../../claude/reference-sources.md) · [`docs/meta/harness-playbook.md`](../../meta/harness-playbook.md)

---

## 0 · TL;DR

- 执行端 Claude **不只是做产品的工人**,更是**让协作循环越用越好的维护者**
- 本 spec 规定一种**定期自审**:执行端定时检查自己的 `docs/claude/*.md` + `docs/meta/harness-playbook.md` + `plans/` 是否跟得上实际在发生的工作
- 跑 3 步:**对齐 learnings / error-patterns / reference-sources** → **回流 harness-playbook** → **回头看产品是否真的好用**
- 输出 `docs/harness-review/YYYY-MM-DD.md` · commit + PR(低风险场景自动合)
- 和 [self-review](./2026-04-18-self-review.md) 的关系:self-review 改产品 · 本 spec 改**产品背后的工作方式**。两者都是"越做越好"循环 · 不可互替

---

## 1 · 问题陈述

今天执行端 Claude 读启动契约(CLAUDE.md + working-protocol + learnings + error-patterns + reference-sources)是**单向**的:读一次 · 开工 · 拿到纠正后顺手记一条 learning 就算完。但:

1. **学习会漂**:一次交互新增的 learning 不一定编号合理 / 描述精确;回头看累积到 L20+ 很多条会发现**有重复**或**该合并**
2. **error pattern 会过期**:E 系列的"已踩过的坑"在代码重构后可能已不再是坑(防御不需要了);但文档里永远写着
3. **reference-sources 会错位**:代码架构一升级(比如本批 9 份 spec 落地后)· 原先对标 `ref-src-claude/V04/Edit.ts` 的行可能在新目录 · 文档还旧
4. **harness-playbook 不同步**:文件在 `docs/meta/harness-playbook.md`(为跨项目复用)· 但本仓新学到的通用教训常忘了回流
5. **产品体感有滞后**:改了一波代码 · 自审过一次("好看好用爱不释手")· 但**10 天后再看**的眼光会新鲜得多 —— 需要一个"冷却后回看"机制

本 spec 把这 5 件事串成一个**季度 / 重大版本后**必须跑的闭环。

---

## 2 · 原则

### 2.1 定期 · 不是心情

触发点:
- **主动**:`cockpit.run_harness_review()` Meta Tool(用户在 chat 里叫 Lead 跑)
- **自动**:一批 spec 全部交付完成 · 跑完 self-review 之后 · **再**跑 harness-review
- **定期**:v1 每周一早自动跑(默认关 · env `HARNESS_REVIEW_WEEKLY=1` 开)

### 2.2 产物 = 差集 + 修缮

每次跑产出:
- 差集:哪些 doc 与当下代码不一致(**可证据化**)
- 修缮:针对每条差集做的变更(条目 P0/P1/P2)
- 保留:**哪些条目不修**及理由(避免清理过度)

### 2.3 冷却后再看产品

**关键环节**:跑完 harness-review 的 Step 1-2 后,Step 3 让 Claude **假装第一次看**这个产品 —— **忘掉自己写过的**,跑一遍关键动线,写"**回头看**"报告:

> 站在 2 周后的自己视角,这产品最让我困惑 / 最让我满意 / 最该下一次优先改的三件事是什么?

这三条**直接**进 `plans/` 成为下一轮需求候选。

### 2.4 闭环回归

Review 发现的坑 → 不只是改 doc · 要么:
- 新增一个回归测试(防止回落)· 写到 `docs/claude/error-patterns.md` 末的 "回归测试索引"
- 或回流到 `docs/meta/harness-playbook.md`(若是跨项目通用教训)
- 或在 `plans/` 开新 plan(若是产品侧要改)

---

## 3 · 流程 · 3 步

### 3.1 Step 1 · 对齐 Claude-facing docs 与代码实况

对每份 `docs/claude/*.md`:

| 文档 | 要检查 | 检查方式 |
|---|---|---|
| `working-protocol.md` | 各阶段清单是否还和实际工作 match · 5 阶段 + 4.5 + 6 是否都被执行过 | 看最近 10 条 commit message / PR / plan 记录 · 有没有"违反但没被阻止"的情况 |
| `learnings.md` L01...L{N} | 有无重复 · 有无已过时 · 编号有无错位 · 每条是否仍可映射到至少 1 处代码证据 | grep 代码引用 · diff 最近 30 天的 commit 找 `(L\d+)` refs |
| `error-patterns.md` E01...E{M} | 防御是否仍在生效 · 回归测试是否仍绿 · 有没有"已不可能发生" | grep 对应回归测试文件 + run 一次 |
| `reference-sources.md` | 每个 ref-src-claude 入口是否仍存在 · 对标表是否跟得上 volumes/V0N 变动 | `ls ref-src-claude/volumes/` 对一遍 · 文件名变了就同步 |
| `harness-playbook.md` | 本仓新 learning 是否有 "跨项目通用" 的 · 还没回流 | 对 `learnings.md` 每条打分 ("仅本仓 / 可通用") · 可通用 + 未回流 → flag |

产出 `docs/harness-review/YYYY-MM-DD/step-1-docs.md`:

```md
# Step 1 · Docs 对齐差集

## learnings.md
- [ ] L07 和 L12 语义重复(都在讲"Tool First 不等于只 Tool") · 合并为 L07',删 L12 · 重编号 L13+ 前移
- [ ] L15 提到的 "runner.run_agent" 函数在 2026-04-12 被重命名为 "AgentRunner.execute" · 正文更新路径
- [x] L01-L06 · L08-L11 · L13-L14 · L16+ 全部对得上 · 不改

## error-patterns.md
- [ ] E04 的回归测试 `tests/learnings/test_L01_tool_first_boundary.py` 引了已删除的 fixture `mock_skill` · 修

## reference-sources.md
- [ ] `ref-src-claude/volumes/V02-query-engine.md` 在最新抓取中改为 `V02-query.md`(文件名) · 对标表路径全改
- [ ] 本批 9 份 spec 的"参考源码"都指向 V01-V0N · 但我看过一遍 V0N 实际还没写完 · 暂标"pending V0N"

## harness-playbook.md
- [ ] L19 "所有事件必走 EventBus 不要 side-channel" 明显是**通用**教训 · 回流精简版
```

### 3.2 Step 2 · 修缮

对 Step 1 每条差集:
- 修 doc(直接改 · git diff 可审)
- 修代码(回归测试 / 文档引用路径)
- 回流 harness-playbook(按 working-protocol § 阶段 3d 的规则)

**合并重编号规则**:
- 删除一条 L/E,后续编号**不前移**(保留空号)· 避免外部引用断
- 合并两条为一条 → 主条保留,副条正文改为 `合并至 L{主}` stub
- 新增不插队 · 永远追加到末尾

### 3.3 Step 3 · 冷却后回看产品

**人格切换**:"我是 allhands 的潜在用户 · 没用过 · 5 分钟体验时间。"

跑一遍 `self-review round-2-flows.spec.ts`(复用 self-review spec 的脚本)· **但输出不同的报告**:`docs/harness-review/YYYY-MM-DD/step-3-fresh-eyes.md`:

```md
# Step 3 · 冷却后回看

## 3 件最该改的事
1. 新用户进 / (cockpit) 没看到"从哪开始"的直接提示 · KPI 都是 0 时尤其懵
   → 建议:空 workspace 时,cockpit 主区改成"首次使用向导"(3 步)
2. Lead 聊天开场白太素 · 缺一点温度
   → 建议:Lead 首次对话出一段"我是谁 · 我能帮你做什么 · 3 个示例"
3. `/tasks` 的详情页 needs_input banner 没有"建议回答"(Lead 已有思路应该给)
   → 建议:request_input 时 agent 可同时附"候选答案" · UI 多一栏

## 1 件最满意的事
- artifact 预览页的 MarkdownCard 字号 / 行距 / 代码高亮看着就想读 · 这感觉留住

## 1 件意外(Round 1-3 都没 catch)
- /observatory 的 iframe 在 Safari 里 cookie SameSite 有兼容问题 · Chrome 没事 · 需要在 proxy 里显式 set
```

这份报告的 "3 件最该改的事" **直接**进 `plans/harness-review-followup-YYYY-MM-DD.md` · 变成新一轮需求。

### 3.4 总结 · `summary.md`

```md
# Harness Review · YYYY-MM-DD · Summary

## 数据
- docs 差集总数:NN · 修:MM · 保留:KK
- 回归测试新增:X 个
- harness-playbook 回流条目:Y 个
- Step 3 "最该改"派生需求:3 条进 plans/

## commit / PR
- chore(harness-review): docs alignment(ref commit abc) 
- chore(harness-review): regression tests(ref commit def)
- docs(harness-playbook): backport L19 generic event-bus rule(ref commit ghi)

## 冷却期
- 下一次 harness-review 建议:YYYY-MM-DD + 14 天 或 下一批 spec 交付后
```

---

## 4 · Meta Tool · `cockpit.run_harness_review`

```python
Tool(
    id="allhands.meta.cockpit.run_harness_review",
    scope=ToolScope.WRITE,
    requires_confirmation=True,
    description="""Kick off the 3-step harness review loop on this repository.
Steps: (1) audit docs/claude/*.md + harness-playbook vs current code (2) fix drift (3)
cool-down fresh-eyes product re-look.
Produces docs/harness-review/YYYY-MM-DD/{step-1-docs.md,step-2-diff.md,step-3-fresh-eyes.md,summary.md}
plus a PR (low-risk auto-mergeable; product follow-up goes into plans/).

Use AFTER a major batch of specs has shipped + self-review has completed.
Don't use more than ~biweekly — the cooling-off period is load-bearing.""",
)
```

同时暴露 REST `POST /api/harness/review` 走 Gate。

---

## 5 · 数据 / 产物目录

```
docs/harness-review/
├─ YYYY-MM-DD/
│   ├─ step-1-docs.md         # 差集报告
│   ├─ step-2-diff.md         # 实际修了什么 · 链到 commit
│   ├─ step-3-fresh-eyes.md   # 冷却回看产物
│   └─ summary.md             # 聚合
└─ history.md                  # 每次 review 一行记录 · 快速翻看
```

`history.md`:

```md
# Harness Review History

- 2026-04-XX · 9 spec 批次后首次 review · drift: 12 · learnings 合并 2 条 · 派生需求 3 条
- 2026-05-XX · biweekly · drift: 3 · no learnings drift
```

---

## 6 · 与已有 doc 的关系

| Doc | 本 spec 关系 |
|---|---|
| `working-protocol.md` 阶段 3d · 5 · 6 | 阶段 3d(生长 harness)和 阶段 6(autopilot)的**跨会话版**就是本 spec。阶段 3d 是**随时**沉淀 · 本 spec 是**定期**审视 |
| `self-review.md`(产品自审)| 产品层闭环 · 跑 3 轮 · 每批 spec 后 · 本 spec 跑**之后**一轮 · 并且**再冷却 2 周** |
| `harness-playbook.md` | 跨项目迁移手册 · 本 spec Step 2 强制审视 "本仓新教训是否回流" |
| `plans/` | Step 3 产物之一 · 自动生成下轮候选 plan |

---

## 6.5 · 参考源码(动手前必读)

| 本节 | 外部参考 / ref-src-claude | 抽什么 · 适配方向 |
|---|---|---|
| **§ 3.1 doc 对齐的 check list 生成** | Claude Code 的 lint / check 脚本(`scripts/` · 若有) | 批量扫 markdown 引用 / 代码符号 · 输出 diff 报告的 idiom。**抽:多文件批 grep + 聚合报告** |
| **§ 3.3 冷却后回看 · "新用户人格"切换** | `superpowers:brainstorming` skill 的 persona 指令 · self-review spec § 2.1 的 3 人格不重叠 | 本 spec Step 3 是 self-review Round 2 的**冷却 + 重跑版** · 共用 Playwright 脚本 · 换一个 prompt persona |
| **§ 2.2 差集 = evidence** | Claude Code 的 todo / plan 工具(V04)· 强调"每条动作都有可溯证据" | doc review 每条都要 grep / commit / 文件行号作为证据,不允许"凭印象" |
| **§ 3.2 删除编号不前移** | Git commit hash / IETF RFC 编号惯例 | 外部引用稳定性。抽"永不重用"的 id 策略 |
| **§ 4 Meta Tool description** | Claude Code 的 Task / TodoWrite description 三段式(V04) | when to use / when NOT to use / params · 仍然是祖师爷 |

---

## 7 · In-scope / Out-of-scope

### In-scope(v0)

- [ ] `docs/harness-review/` 目录 + README + history.md
- [ ] `scripts/harness/audit-docs.sh`(运行所有 doc 对齐检查 · 输出 step-1-docs.md 草稿)
- [ ] `scripts/harness/run-review.sh`(编排 Step 1 → Step 2 提示人工 → Step 3)
- [ ] Meta Tool `cockpit.run_harness_review`
- [ ] REST `POST /api/harness/review`
- [ ] 首次 dry-run 后沉淀产物 · 并回流 1-2 条到 harness-playbook
- [ ] `working-protocol.md` 末尾加"定期 harness review"小节指到本 spec

### Out-of-scope(v1+)

- LLM-as-judge 打"每条 L 条目是否过时"的分(v0 靠执行端自审)
- CI 自动每周 cron
- 跨仓 review(本 spec 只审当前仓)
- 反向:用户给执行端"打分" review 质量

---

## 8 · 测试

- `tests/unit/harness/test_audit_docs.py` — mock 一个 learnings.md 含重复 / 失效引用 · audit 脚本输出预期差集
- `tests/integration/api/test_harness_api.py` — REST 触发 review · 产物目录存在 + summary.md 非空
- `tests/unit/tools/test_harness_meta_tool.py` — cockpit.run_harness_review 的 scope / description 合规
- **首次 dry-run**:执行端亲自跑一次本 spec,产物 commit · 人工 spot-check 5-10 条

---

## 9 · DoD checklist

- [ ] `docs/harness-review/2026-04-XX/summary.md` 生成 · 有 Step 1/2/3 产物
- [ ] 至少 1 条 learning 被优化(合并 / 更新 / 补证据)· git diff 可审
- [ ] 至少 1 条教训回流 `harness-playbook.md`
- [ ] 至少 1 条 Step 3 "最该改" 进 `plans/`
- [ ] `./scripts/check.sh` 全绿
- [ ] `working-protocol.md` 已引用本 spec
- [ ] `cockpit.run_harness_review` 在 chat 能调

---

## 10 · 开放问题 · Decision defaults

1. **Q**: Step 3 的"冷却"真的需要时间流逝吗 · 还是换个 prompt 就够?
   **Default**: 两者都要。time-based cooling 最稳;本 spec 强制建议 ≥ 7 天间隔(summary.md 显示);短期版本用 prompt persona 兜。

2. **Q**: Review 发现 learnings 条目"似乎已过时",要不要删?
   **Default**: 不删 · 改为 "归档" 状态(正文加 `[Archived YYYY-MM-DD: reason]`)· 保留编号 · 不前移。

3. **Q**: Step 3 "最该改"自动进 plans 会不会污染 plan 目录?
   **Default**: 自动但命名规范:`plans/harness-review-followup-YYYY-MM-DD.md` · 标明"候选" · 由用户拍板要不要真做。

---

## 11 · 交给 autopilot 前的最后一步

**本 spec 是一个 meta-spec**:它定义"执行端如何审视自己的工作方式"。所以执行端本人必须:

- 实装完后 · **亲自跑一次**(dry-run 条件:9 份 spec + self-review spec 都已交付 + self-review 已跑过一轮)
- **首次跑要在本仓真的发现 ≥ 3 条 doc drift**(否则本 spec 是空操作 · 说明还不成熟)
- **把首次产物进 commit · 不藏私**:执行端反思自己的协作循环是最珍贵的 artifact

---

## Decision-log

- **2026-04-18 创建**:harness-review 成为第二条反思循环 · 和 self-review 并列 · 强调"冷却后回看"
