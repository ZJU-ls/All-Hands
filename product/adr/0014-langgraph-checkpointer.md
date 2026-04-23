# ADR 0014 · 引入 LangGraph Checkpointer · 把 thread_id 接成真正的 resume 载体

**日期:** 2026-04-23  **状态:** Proposed(草稿 · 等 maintainer 审议 · 通过后进入 `Accepted, impl pending` → 分阶段落地)

## Context

v1 `AgentRunner.stream` 在 `runner.py:488` 这一行是这样的:

```python
agent = create_react_agent(model, lc_tools)
async for chunk in agent.astream(
    {"messages": lc_messages},
    config={"configurable": {"thread_id": thread_id}},
    stream_mode="messages",
):
```

`thread_id` 传进去了 · 但 `create_react_agent` **没有 `checkpointer=` 参数**。LangGraph 的 checkpointer 没接,这等于 `thread_id` 只是一个在 trace metadata 里躺着的字符串 —— **LangGraph 什么状态也没按这个 id 持久化**,"短期记忆"完全靠 app 层 `MessageRepo` + `chat_service.send_message` 每轮 replay 全量历史到 `lc_messages` 来维持(ADR 0011 原则 3 · Pure-Function Query Loop)。

这在 v0 的"简单 chat turn"范围里是成立的 —— 状态只有"消息历史"一种,而消息历史已经有独立的业务真相(`MessageRepo`)。但 v1 引入的三个新状态类型让这个模型开始绷不住:

1. **Confirmation Gate 挂起态** · `runner.py:412-444` 的 gate 在 WRITE tool 触发时会 `await gate.request(...)` 阻塞 tool 执行 —— 当前靠 `ConfirmationRepo` 单独存,但**如果 uvicorn 重启**,挂起的 tool 节点丢了运行态,resume 只能靠前端重新触发一个"用户刚回答了 yes"事件,走不回原来的 tool 节点。不是坏事但反复 E18 类竞争。
2. **Subagent 中间态** · `spawn_subagent` / `dispatch_employee` 的子 run 各自有 `SkillRuntime`(ADR 0011 已经持久化)但**调用栈**没持久化 · 父 run 等到 `render_plan` 的 interrupt 时,重启丢栈,子任务的中间思考白做。
3. **Interrupt + resume 对称** · 未来 `interrupt()` 节点(LangGraph 原生抽象)在 agent 里停住等用户输入 —— 当前没接,因为 checkpointer 没挂。接 interrupt 需要有 checkpoint。

同时,用户在 2026-04-23 的对话里提出了方向性的建议:

> "对外存储 AG-UI 交互协议,对内提供 checkpointer 支持回溯。两者间动态结合。"

这个方向和本仓**已经在做的**事情已经对齐一半:
- **AG-UI 对外协议** · [ADR 0010](0010-ag-ui-protocol-adoption.md) / I-0017(2026-04-19 落地)· 四个 SSE endpoint 全切 AG-UI v1 事件 · `backend/api/ag_ui_encoder.py` / `web/lib/stream-client.ts` parse 11 typed 回调 · 已是 Accepted
- **Checkpointer 对内** · 本 ADR 现在才正式提

ADR 0011 原则 7"层隔离 + 状态可 checkpoint" 明文:

> "完整 LangGraph Checkpointer 是 v2 的故事 · 本条只要求『可持久化』,不强制 framework"

v1 的"可持久化"靠 app 层的各种 repo(`MessageRepo` / `ConfirmationRepo` / `SkillRuntimeRepo` / `ArtifactRepo`)满足契约,但**这些 repo 是各自为战的**——它们不知道彼此的存在,也不知道 LangGraph graph 本身到哪一步了。所以每加一个新的"会暂停的节点"(spawn_subagent / interrupt / 长时 tool / human-in-the-loop plan),就要在 app 层再造一个 repo。这一条路径成本会随新节点类型**线性增长**。

LangGraph 的 checkpointer 是为这个问题设计的:一个**graph-aware 的持久化层**,自动对 node 之间的 state transitions 存档,不用每种节点单独做 repo。

## Decision

**v1.1 起,`AgentRunner` 接 LangGraph `AsyncSqliteSaver` 作为内部 checkpointer · `thread_id` = `conversation_id`**。引入下面的**语义分工**让它和现有 `MessageRepo` 共存而不冲突:

### 1. 状态分类与真相源

| 状态类别 | 真相源(Source of Truth)| 用途 | 暴露给谁 |
|---|---|---|---|
| 用户可见的消息账本 | **`MessageRepo`(既有)** | 对话历史 / 计费 / compaction / 跨 session 复述 · API `GET /messages` 读这里 | UI · Agent(replay 到 `lc_messages`) · Observatory |
| Graph 内部状态 | **`AsyncSqliteSaver`(新)** | interrupt / tool pending / subagent stack / per-run 中间态 · `thread_id=conversation_id` 统一键 | 只给 `AgentRunner` 内部 · 不暴露到 `services/` 以上 |
| Skill 激活状态 | **`SkillRuntimeRepo`(既有)** | 哪些 skill 已 resolve / 哪些 tool_id 已 materialize | Runtime rebuild(per turn) |
| Confirmation 挂起 | **`ConfirmationRepo`(既有)** | 用户还没回答的 gate 请求 | Gate 查 / UI 查 |
| Artifact | **`ArtifactRepo`(既有)** | 制品持久化 | UI / SSE |

关键判定:**两个 SoT 不是"同一状态两份",而是"互补的切片"**。MessageRepo 记录"用户和 agent 之间的对话账本";Checkpointer 记录"graph 在 turn 内部到了哪一步"。

### 2. 硬契约(必须遵守)

**R1 · Checkpointer 只在 `execution/` 层可见。**
- `AgentRunner.__init__` 吃一个 `checkpointer: BaseCheckpointSaver | None` · None = 降级为现行 pure-function 行为(兼容测试)
- `services/` / `api/` / `core/` **不许** import `langgraph.checkpoint.*` · 违规 `lint-imports` 打回 · 新增规则进 `pyproject.toml [tool.importlinter]`

**R2 · `MessageRepo` 仍是消息的 SoT · 不读 checkpoint 内的 messages 给 UI。**
- 哪怕 LangGraph 的 `MessagesState` 把消息也存进 checkpoint,`GET /messages` **必须**走 `MessageRepo` · 不穿透到 checkpointer
- 原因:checkpointer 内存的是"graph 在某 turn 某步骤的 snapshot",含中间态 + 被 compaction 去掉的历史 + tool message · 和"用户可见账本"不是一个概念

**R3 · 两个 SoT 必须时序一致。**
- 任何把消息写进 graph state 的路径,同时也要写进 `MessageRepo`(或者相反)· 以避免"UI 看到一条 assistant 回复 / checkpoint 里没有"的漂移
- `chat_service._persist_assistant_reply` 既有的 "tap SSE + write Message" 管道继续是这条契约的实现;checkpointer 是**旁路**,不替代它
- 回归:`test_dual_sot_consistency.py`(新)· emit 一条 assistant stream → 断言 MessageRepo 和 checkpointer 里的最新消息 hash 一致

**R4 · checkpointer 不替代 `SkillRuntimeRepo` / `ConfirmationRepo` / `ArtifactRepo`。**
- 这些 repo 是**业务实体**,有独立的 lifecycle(skill 可以跨会话共享 · confirmation 有 TTL · artifact 被外部 consumer 读)· 放 checkpointer 里等于把它们的生命周期绑在"某次 agent run"上,会丢失跨 run 语义
- checkpointer 只负责"graph 运行时内部状态"—— 具体就是 `MessagesState` + `interrupt()` snapshot + tool pending · 别的不碰

**R5 · Resume 语义是"graph 可以从上次 interrupt 点继续",不是"所有状态自动恢复"。**
- Uvicorn 重启 → 下一个 chat 请求带着 `thread_id=conversation_id` → 如果 checkpoint 里有 pending interrupt,LangGraph 自动从那里继续 · 同时 `SkillRuntime` / `ConfirmationRepo` 照常从各自的 repo 加载 · 不冲突
- 回归:`test_resume_after_restart.py` · 模拟 interrupt 发生 → 模拟"重启"(drop AgentRunner · 新建一个共享同 checkpointer)→ 重新 invoke 带 thread_id → 断言从 interrupt 点继续

**R6 · 所有 checkpoint writes 落在 SQLite 同一个 DB(`backend/data/app.db`)· 不开单独文件。**
- 同一个 `aiosqlite` 连接池 · 同 `PRAGMA foreign_keys=ON` + `journal_mode=WAL`(沿用 L15 / E19 修复)
- 避免再开一个 DB 文件增加部署复杂度(Docker volume + backup + migration 都要两倍)
- LangGraph 提供 `AsyncSqliteSaver.from_conn_string(...)` 直接接 aiosqlite · 天然兼容

### 3. 实现路径(4 个 PR · 分阶段可独立 merge)

**Phase 1 · 接 AsyncSqliteSaver(only · feature-flagged)**
- 新增依赖 `langgraph-checkpoint-sqlite`(已在 `langgraph` 的 optional extra · 确认 pyproject 有 extra)
- `execution/runner.py` · `AgentRunner.__init__(...,  checkpointer: BaseCheckpointSaver | None = None)` · `create_react_agent(model, lc_tools, checkpointer=self._checkpointer)` · `config={"configurable": {"thread_id": thread_id}}` 保持不变
- `services/chat_service.py` · 从 DI 拿到 checkpointer(新 `get_checkpointer` 依赖)· 传给 `AgentRunner`
- `api/deps.py` · 新建一个进程单例 `AsyncSqliteSaver` · `await saver.setup()` on app startup · 关 app 时 `await saver.close()`
- Feature flag `ALLHANDS_ENABLE_CHECKPOINTER=1`(env)· 默认关 · 给 staging 单独开 · 生产灰度
- **Dod · Phase 1:**
  - 开关关 → 所有 1064+ pytest + 1580+ vitest 绿(兼容模式不破坏)
  - 开关开 → 新增 3 条 smoke:simple chat / 带 interrupt 的 chat / 带 spawn_subagent 的 chat,全绿
  - `sqlite3 app.db "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'checkpoint%';"` 有 LangGraph 预期的 `checkpoints / writes / ...` 表

**Phase 2 · 双 SoT 一致性契约 + 回归**
- 新写 `test_dual_sot_consistency.py` · 一轮 assistant stream → `MessageRepo.list_messages(conv)[-1].id == latest(get_state(thread).values['messages']).id`
- lint-imports 规则 · services/api/core 禁止 import `langgraph.checkpoint.*` · 违规 → CI 红
- L14 + E24 扩展:checkpointer 里的"graph state messages" **不是** list_messages 的数据源 · 写进注释 + 测试

**Phase 3 · 把 interrupt() 接起来(现阶段只做 placeholder · 实际替换 ConfirmationGate 在 Phase 4)**
- runner.py 支持发现 `interrupt()` 事件 · 通过 AG-UI `CUSTOM.name="allhands.interrupt_required"` 暴露给前端(不改 UI 语义,UI 还是 ConfirmationDialog)
- 测试点:`test_interrupt_then_resume.py` · fake graph 在 node B 调 interrupt → SSE 收 CUSTOM · 客户端 "回答" → re-invoke with command → 从 node B 继续到 C · 断言 state 里的累积数据正确

**Phase 4 · 迁移 ConfirmationGate 到 interrupt() + 保留回调 · 去掉 feature flag**
- `ConfirmationGate.request(...)` 内部改用 `graph.interrupt(...)` · `resolve(decision)` 改用 `graph.stream(command, thread_id)` 继续
- `ConfirmationRepo` 保留(用户查"有哪些还没回答的 gate"场景要独立查询路径)· 但它的写入从"gate 挂起时" → "interrupt 被发出时"
- Feature flag 去掉 · checkpointer 成 default-on
- **ADR 0011 原则 7 回头修正:** "v2 的故事"改成"v1.1 落地 · 通过 ADR 0014 实现"

### 4. 为什么不把 LangGraph `MessagesState` 直接当消息账本

这是最诱人的简化:graph state 里本来就有 messages · 让 LangGraph 管全部,app 层不再维护 MessageRepo。**不采纳,原因有四:**

1. **消息是业务实体,不是 graph 副产物** · 计费 / compaction / audit / API / 跨 session 复述都要的,跨 graph instance 跨 run 跨 uvicorn 重启稳定存在的 entity。graph state 是"某一次 run 的中间变量",语义不同。
2. **multi-employee dispatch 语义冲突** · spawn_subagent 让子 employee 跑子 graph · 子 graph 的 MessagesState 和父 graph 的 MessagesState 是**两份** · 但用户看到的对话账本是**一份**(父的)· 如果 graph state 当 SoT,就要处理"哪些子 run 的消息冒泡到父"的复杂聚合。MessageRepo 作为独立 SoT,父 append · 子的消息进子的 repo 或 artifact,层次清晰。
3. **compaction 与 checkpoint 冲突** · `chat_service.compact_conversation` 现在能把老消息换成一条 system marker · 如果消息 SoT 在 checkpointer 里,compaction 要去改 checkpoint,而 checkpoint 的 purpose 是 immutable snapshot,改 snapshot 等于打破 resume 假设。
4. **原则 3 · Pure-Function Query Loop 不想放弃** · runner 是 pure function "每轮重新计算"的原则来自 Claude Code 的核心主循环,ADR 0011 正式升格为一级原则。Checkpointer 的加入是"支持 pause/resume",不是"让 runner 带状态"—— runner 读 messages from MessageRepo → 每轮 rebuild lc_tools + prompt 的语义不变。

### 5. 为什么不自己手写 checkpointer

也诱人:graph state 就是一个 dict,序列化到 JSON,存 `runner_checkpoints` 表。不采纳:

- LangGraph 的 checkpointer 是 graph node 之间**自动保存** · 自己写要 hook 每个 node transition(`before_node` / `after_node`)· 100 行代码起步
- 未来 LangGraph 升级可能改 state protocol(V2 正在改)· 自己写要跟着重写一次 · 官方 `AsyncSqliteSaver` 跟随升级
- checkpoint 语义(读 latest / 列 history / time-travel / branch)LangGraph 已实现 · 重造不划算
- 本仓已经有 4 个 repo(Message / SkillRuntime / Confirmation / Artifact)· 第 5 个手写 repo 只会让"状态在哪"的 mental map 更乱

## Consequences

### 正向

- **Phase 4 完成后:** uvicorn 重启不丢 interrupt / tool pending · 用户"机器重启了要再回答一次 gate"的体验消失
- **Subagent 的断点续跑**可能(v2 follow-up):父 agent 在 `render_plan` interrupt 的同时,子 subagent 的 stack 已经 checkpoint,用户回答后子 subagent 继续跑 · 而不是从头重来
- **契约一致性**:`thread_id` 从"trace metadata 字符串" → 真正的 resume 载体 · 和 [Claude Code `--resume <session>`](../../docs/claude/reference-sources.md) 语义对齐
- **原则 7 从 "v2 待办" 兑现** · ADR 0011 有一条遗留待办转成 Accepted

### 负向 / 成本

- **依赖增加**:`langgraph-checkpoint-sqlite` · 官方维护 · 风险低 · 但新版本 bump 要看 LangGraph release cycle
- **双 SoT 心智成本**:今后 review 要分清"消息写 MessageRepo" vs "graph state 写 checkpointer",新人上手多一个契约要读 · 用契约文档 + lint-imports 来兜
- **DB size 上涨**:每次 graph transition 都有 checkpoint row · SQLite 估计增加 ~10-50 KB/turn · 一个活跃 conversation 一天 50 turn = 2.5 MB · 全局 100 并发用户 = 250 MB/天 · 需要一条 cleanup job(keep last N checkpoints per thread)· Phase 5 / v2 考虑
- **Pure-Function Query Loop 原则的表述需要微调**:原则 3 目前的条文是 "runner 读入、yield AgentEvent、不把 LangGraph 类型泄漏" · 接 checkpointer 后 runner 仍然是 pure-function 对 **input messages 和 config** 的组合,但多了一个"外部状态读写端口" · 需要在原则 3 的 Invariant 里补一句"checkpointer 是 ExternalState 端口,不破坏 pure-function 性质(读 config 等价于读 state,state 的 mutation 由 framework 而非 runner 发起)"

### 风险

- **双写漂移**:MessageRepo 写了但 checkpointer 没写(或反之)· 缓解见 R3 + test_dual_sot_consistency · 出问题时以 MessageRepo 为准(R2)
- **SQLite 并发**:checkpoint write 和业务 write 抢锁 · 风险 E19 类 · 缓解:沿用 WAL + best-effort(graph 层的 write 自己 batch · 不在 SSE 热路径上同步 await)
- **Migration 到 Phase 4**:删 feature flag 时要跑一次双模式对比回归(flag on vs flag off 行为是否 equivalent)· Phase 4 前做 pre-migration regression week

## Alternatives

### A0 · 不做(保持现状)
- **Pros**:零成本 · 原则 7 v2 话术继续生效
- **Cons**:每多一种"暂停节点",就要再造一个 repo;无法响应用户 2026-04-23 的架构建议;interrupt 永远接不了
- **为什么不选**:v1 已经碰到 3 个状态类别(Confirmation / Subagent / Skill),每加一个手写 repo 的累积成本 > 一次性接 LangGraph checkpointer

### A1 · 自己写 RunnerCheckpointRepo(不用 LangGraph 官方)
- **Pros**:app 层完全自控 · 不依赖 LangGraph 版本升级
- **Cons**:要自己 hook node transitions · 100+ 行新代码 · 持续维护 · 重造轮子
- **为什么不选**:LangGraph 就是做这个的 · 自己写既不如它完善也不如它兼容未来

### A2 · 把 MessageRepo 下沉成 checkpointer 的"messages" 字段读取
- **Pros**:单一 SoT · 心智简单
- **Cons**:见 Decision §4 的四条拒绝理由(业务实体 / dispatch 冲突 / compaction 冲突 / pure-function 原则)
- **为什么不选**:业务语义清晰度 > 实现统一感

### A3 · 用 Redis / 单独 DB 文件做 checkpointer
- **Pros**:业务 DB 和状态 DB 隔离 · 各自 scale
- **Cons**:多一个运维组件(Redis)· 或多一个 DB 文件(备份 / 迁移 / 监控×2)· 违反 [ADR 0002](0002-sqlite-as-primary-db.md) 的 "SQLite as primary DB" 决定
- **为什么不选**:v1 MVP 阶段还在单机 · Redis 是 v2+ 再说

## References

### 本仓
- [ADR 0002 · SQLite as primary DB](0002-sqlite-as-primary-db.md) · R6 同 DB 的出处
- [ADR 0010 · AG-UI Protocol 采纳](0010-ag-ui-protocol-adoption.md) · 对外协议那半已完成 · 本 ADR 补对内那半
- [ADR 0011 · 原则 refresh](0011-principles-refresh.md) · 原则 3 / 原则 7 的出处 · Phase 4 完成后回头改该 ADR 的"v2 待办"
- [`backend/src/allhands/execution/runner.py:488-508`](../../backend/src/allhands/execution/runner.py) · 当前 `create_react_agent` 调用 · 无 checkpointer 的证据
- [`docs/claude/learnings.md § L11`](../../docs/claude/learnings.md) · bug-fix 三件套 · 实施过程中必依赖
- [`docs/claude/reference-sources.md`](../../docs/claude/reference-sources.md) · Claude Code `--resume` 参考

### 外部
- [LangGraph · Persistence and Memory](https://langchain-ai.github.io/langgraph/concepts/persistence/) · checkpointer 语义 + thread_id 模型
- [LangGraph · AsyncSqliteSaver API](https://langchain-ai.github.io/langgraph/reference/checkpoints/#langgraph.checkpoint.sqlite.aio.AsyncSqliteSaver) · 本 ADR 选型
- [LangGraph · Interrupts](https://langchain-ai.github.io/langgraph/concepts/human_in_the_loop/) · Phase 3/4 的底层原语
- [Claude Code `--resume`](../../ref-src-claude/) · 对标的 resume 体验(见 reference-sources § V02)

## Status log

- **2026-04-23** · Proposed · 草稿 · 用户对话里建议接 checkpointer · 认可方向 · 走 ADR 流程
- 待 · maintainer review · 通过后 → Accepted, impl pending · 进 Phase 1
