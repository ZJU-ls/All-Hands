# ADR 0011 · 核心原则 refresh · 4 条 → 6 条

**日期:** 2026-04-21  **状态:** Accepted

## Context

`00-north-star.md §3` 的 4 条核心原则(Tool First · 统一 React Agent · L4 对话式 + 护栏 · 低耦合 / 高扩展)在 v0 MVP 一路跑下来验证成立,但 v1 进入过程中暴露两个契约层缺口:

1. **关键抽象被埋没在"Tool First 的推论"里** —— `SkillRuntime`(动态能力包)、`spawn_subagent` / `dispatch_employee`(子 agent 协作)、`runner.stream()` 的 per-turn pure-function 重建 —— 这些已经是 runtime 的一级行为(见 `execution/runner.py` / `execution/skills.py`),但原则层没提,新人读 4 条原则时看不见,挖到 ADR / 代码才发现,导致 review 和设计讨论反复回到"这是哪一条原则的推论"。
2. **状态可观察性 / 可恢复性没写契约** —— `SkillRuntime` 是进程内存,重启就丢;`thread_id` 传给 LangGraph 但客户端 resume 没 checkpoint。状态契约的缺失意味着一次 uvicorn reload 就让 skill 激活状态消失,用户感知到"怎么又要 list_* 一遍"。

与此同时,本仓在 `execution/runner.py` / `docs/claude/learnings.md` / `docs/tracks/` 反复引用两个参照系:

- **Claude Code**(`ref-src-claude` · 本仓多个文件引 V02 / V04 / V05 源码注释)—— `query(state) → state'` pure loop · tool 是原子能力 · skill 是动态 capability pack · subagent via Task tool · permission scope gate · context engineering over prompt tuning
- **LangGraph / LangChain** —— graph node / checkpointer / interrupt / subgraph / streaming modes · 我们用的是 `create_react_agent` + `stream_mode="messages"` + `thread_id`,已经是 LangGraph 的消费方

两个参照系的核心抽象**本仓已经部分采纳**,但契约层没把它们升级为一级原则,出现了"代码实现在、契约没明说"的断裂。本次 refresh 就是把已经存在的抽象正式写进原则,同时引入一条新契约约束状态可恢复性,让实现有牵引力。

## Decision

### 1. 4 条原则升级为 6 条

| # | 旧(v0) | 新(v1) |
|---|---|---|
| 1 | Tool First | **Tool First**(保留原文,含 3 种 kind + 4 种 scope + gate 分区) |
| 2 | 统一 React Agent | **统一 React Agent**(保留 · 强调没有 `mode` 字段) |
| 3 | — | **Pure-Function Query Loop**(新 · 从 `runner.py` 注释上升 · 参考 Claude Code `query()` 主循环 + LangGraph graph-as-state-transform) |
| 4 | — | **Skill = Dynamic Capability Pack**(新 · 从 Tool First 的推论上升 · 参考 Claude Code skill 体系) |
| 5 | — | **Subagent 是 Composition 基元**(新 · 从 ADR 0005 + `spawn_subagent` / `dispatch_employee` 上升 · 参考 Claude Code Task tool + LangGraph subgraph) |
| 6 | L4 对话式操作 + 护栏 | **L4 对话式 + 护栏 + Interrupt**(保留 · 把 LangGraph interrupt 语义正式写进来,与 ConfirmationGate 一致) |
| 7 | 低耦合 / 高扩展 | **低耦合 / 高扩展 + 状态可 checkpoint**(保留 + 补一条"状态必须可持久化、可 resume") |

(新原则 6 条编号按上表 1-6,顺序:Tool First → Query Loop → Skill → Subagent → L4+Gate → Layer+Checkpoint。)

### 2. 每条原则必须写明"来源 / 不变量 / 回归防御"

北极星文件 §3 的每条原则从"一段散文"改成结构化条目:

```markdown
### 原则 N · <名字>

**不变量(Invariant):** <一句话,可被测试检测>

**来源(Reference):** Claude Code <章节> / LangGraph <抽象> / 本仓 <代码位置>

**推论(Implications):** <2-4 条>

**回归防御(Regression):** <回归测试路径 / lint 规则 / 契约扫描>
```

这个结构把每条原则都落到一个**可检测的不变量** + **可回退的回归测试**上,避免原则沦为"哲学散文"。

### 3. SkillRuntime 状态持久化(落实原则 6 的状态可 checkpoint 条款)

新增:

- `core/skill_runtime.py` —— `SkillRuntime` 领域模型(从 `execution/skills.py` 搬出 · 让 `persistence/` 可以 import 而不违反分层)
- `persistence/repositories.py` —— `SkillRuntimeRepo` Protocol(load / save / delete)
- `persistence/sql_repos.py` —— `SqlSkillRuntimeRepo` · 单表 `skill_runtimes` · PK = `conversation_id` · body = JSON(descriptors / resolved_skills / resolved_fragments · base_tool_ids)
- Alembic `0015_skill_runtime.py` —— 新表迁移
- `services/chat_service.py` —— 内存 cache 作为热路径,miss 时从 repo load,send_message 结束时 flush 回 repo;compact 时同步 delete runtime

**cache 策略:** 内存优先(0 IO),miss → repo.load() → 写回 cache;写入路径 send_message 结束统一 flush(runner.stream 结束后,一次 upsert)。compact 里 cache.pop + repo.delete 同步走。

**为什么不是 checkpointer 完整方案:** LangGraph 的完整 `Checkpointer` 语义(resume 任意中间状态 · interrupt resume)要求记录每条消息 + 工具调用的全量 state snapshot,体量和 bug 面都远大于本次 refresh 的收益。SkillRuntime 是用户感知层的"我选过什么 skill"这一条键,持久化它就覆盖了最高频的丢状态场景(uvicorn reload / 多实例),其余由 LangGraph 的 `thread_id` + 消息表 replay 已经能 reconstruct 足够上下文。后续需要完整 checkpointer 时另开 ADR。

### 4. Write Gate 与 ADR 流程不变

本 refresh 自己就是契约级变更,必须走 ADR(本文件)+ 同步改 `CLAUDE.md §3` + `00-north-star.md §3` + `learnings.md` 交叉引用,所有下游文档引用"4 条原则"的措辞全部改成"6 条原则"。

## Rationale

### 为什么增加 3 条 而不是替换 / 重组

保留原 4 条的**文字完全不动**(仅为原则 7 加一条状态 checkpoint 推论),新增的 3 条(Query Loop / Skill / Subagent)都是"把已经存在于 runtime 的不变量,提到原则层命名"。这样:

- **零代码反向风险**:新原则对应的代码已经实现且稳定(`runner.py` 每轮重建 · `SkillRuntime` per-conversation · `spawn_subagent` 上了 v0)。契约追认,不是契约先行。
- **零下游工作反向风险**:ADR 0003-0010、`04-architecture.md L4-L10` 的叙事不变。只是原则层多了 3 条显式项目作为"Table of Contents"。
- **契约检测点增加**:每条新原则有自己的不变量 + 回归测试。Query Loop 有 `test_runner_per_turn_rebuild`;Skill pack 有现有 `test_skill_runtime_*`;Subagent 有 `test_spawn_subagent_*`。

### 为什么把 LangGraph checkpointer 范围限制到 SkillRuntime,不全量上

全量 checkpointer = 每次 tool call 都 snapshot graph state → SQLite 写放大 10-20x,且需要解决 LangGraph 内部对象的序列化一致性(AIMessageChunk 不是 Pydantic · 版本升级会碎)。SkillRuntime 是**平台自己定义的**领域对象,Pydantic `model_dump_json()` 稳定,重启 resume 覆盖 80% 用户感知丢状态的场景,边际 bug 面最小。

### 为什么借鉴 Claude Code 而不是 n8n / CrewAI

见 `00-north-star.md § 差异化`:我们的定位是"对话操作 + 可观测",与 Claude Code 的"单一 L4 agent + tool 体系"同源;与 n8n / CrewAI 的"可视化工作流 / 多 agent 编排库"不同源。借鉴 LangGraph 是因为我们**就在用它的 `create_react_agent`**,借鉴它的 checkpointer / interrupt 是自然推论,不是跨界。

## Consequences

### 正面

- 6 条原则结构化(不变量 / 来源 / 推论 / 回归)后,每条都有可回退的测试钉,review 不再争论"是不是违反了 4.3"
- `SkillRuntime` 重启不丢,用户不再感知"skill 状态被重置"
- ADR 0003-0010 与新原则层形成清晰映射,新人读 ADR 有导航

### 负面

- 原则数量从 4 → 6,认知负担增加(但每条有一句话不变量,扫一眼就知道)
- `SkillRuntime` 从进程内存变成 DB 状态,多了一张表和一条 migration 要维护
- ~~后续若引入完整 LangGraph Checkpointer,本条 ADR 要 supersede 掉(不是升级,是替换),但那是 v2 的故事~~ **2026-04-23 更新:** 完整 LangGraph Checkpointer 已通过 [ADR 0014](0014-langgraph-checkpointer.md) 落地(Phase 1-3 完成 · Phase 4a-4b 完成 · Phase 4c-4e 作为后续 plan)。本 ADR 原则 7 的"可持久化、可 resume"条款现在有 framework 级支持:`MessageRepo` 仍是用户可见的消息账本 SoT,`AsyncSqliteSaver` 持久化 graph 内部状态(interrupt / tool pending / subagent stack)。两者通过 ADR 0014 R2 契约分工,不冲突。

### 中性

- `execution/runner.py` 代码不改(新原则 3 / 4 / 5 都是追认)
- `execution/skills.py` 仅轻微改:`SkillRuntime` 类搬到 `core/skill_runtime.py`,保留 re-export 维持向后兼容
- 前端零改动(SkillRuntime 持久化对 UI 透明)

## Alternatives

### A. 不改原则,只改实现(SkillRuntime 持久化)

**否决:** 用户明确要求"参考 Claude Code + LangGraph 核心理念,改核心原则",只动实现等于阳奉阴违。

### B. 4 条 → 5 条(合并 Skill + Subagent 为一条"动态组合")

**否决:** Skill 是"能力包 · 激活式扩展",Subagent 是"子进程 · spawn 式隔离",语义差异明显(一个是主 agent 内扩能,一个是新开 agent 进程)。合并会丢失现状已经实现的语义分层。

### C. 4 条 → 7 条(把 Hooks / Context Engineering / 可观测各自单列)

**否决:** Hooks 在本仓对应 `event_bus` + `cockpit_service`,但还没成为"用户可注册的扩展点"(v0 只有平台自己用);不够成熟不能进原则。Context Engineering 是 compact + skill 激活的组合效果,不是单独的一条原则。可观测性是"L4 + 护栏"和"低耦合"的推论,不单列。

### D. 完整 LangGraph Checkpointer 替换 SkillRuntime

**否决:** 见 Rationale 第 2 节。v2 再说。

## 实施清单(本 ADR 的 PR 必须全部完成)

- [x] 写本 ADR
- [ ] 改 `product/00-north-star.md §3` · 4 条 → 6 条结构化
- [ ] 改 `CLAUDE.md §3` · 镜像北极星 · 加交叉引用
- [ ] 改 `product/04-architecture.md` · 把 "4 条核心原则" 的措辞改为 "6 条"(目录 / 引用)
- [ ] 改 `docs/claude/learnings.md L01` · 提及 4 条原则的地方改为 6 条 + 交叉引用 ADR 0011
- [ ] 实现 `core/skill_runtime.py` · `persistence/SkillRuntimeRepo` · Alembic migration · ChatService 接入
- [ ] 失败测试先行(TDD):runtime 跨 process 持久化测试
- [ ] `./scripts/check.sh` 全绿
- [ ] 交付验收包(plans/2026-04-21-principles-refresh.md 末尾 · 含浏览器/curl 实证)
