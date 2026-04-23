# ADR 0017 · 事件日志 + 纯投影 · Claude Code 为首要架构参考

**日期:** 2026-04-24  **状态:** Accepted

## Context

v1 里落地 ADR 0014 之后,`allhands` 的消息存储结构是:

- **MessageRepo**(`messages` 表)· 用户可见账本 · 前端 `GET /messages` 的数据源
- **LangGraph Checkpointer**(`checkpoints.db` · `AsyncSqliteSaver`)· graph 内部状态 · thread_id = conversation_id
- **Delta-send 契约**(ADR 0014 R3)· 热轮只送新 user 消息 · 冷启走 bootstrap full-history · 靠 `add_messages` reducer 按 `msg.id` dedup

这是一个"两个 SoT 互补切片"的设计。意图合理,但落地后出现了**真正的病根**:

### 1. E26 类 bug · 非连续 system messages 累积 → Anthropic API 拒绝

`create_react_agent(prompt=SystemMessage)` 走 prompt hook 不会进 messages 通道 · 但一旦 hook 之外也有一份 SystemMessage 从 lc_messages 侧注入,`add_messages` reducer 按 id dedup 的前提被破坏,非连续 system 消息在 checkpoint state 里累积。Anthropic messages API 严格要求 user/assistant 交替 → 400。

表面修 hotfix 之后,仍然"**还有没发现的同型 bug**"的担忧挥之不去。

### 2. Dual-SoT 一致性税

两个 SoT 意味着每加一种新状态(tool_call 粒度 / compaction summary / interrupt snapshot / subagent sidechain)都要同时考虑:

- MessageRepo 怎么存 / 怎么对前端呈现
- Checkpointer 里 `MessagesState.messages` 会不会漂
- `add_messages` reducer 按 id dedup 的不变量会不会被破
- Compaction 动哪一边(ADR 0014 R3 Decision 4:只动 MessageRepo · 不动 checkpointer)

每个新 feature 都在付这份 dual-SoT 的**一致性税**。`test_dual_sot_consistency.py` / `test_dual_sot_delta_consistency.py` / `test_dual_sot_stable_ids.py` 这三条回归线,本质是在**守一个复杂约束不倒**,而不是在验证一个简单不变量。

### 3. Delta-send 是对 `add_messages` reducer 的复杂规避

Delta-send 不是性能要求(热轮单消息 vs 全量的差异 · 在 provider 侧由 prompt caching 更便宜地解决);它是**被 `add_messages` reducer 按 id dedup 的机制逼出来的**—— 每轮全量发会让 reducer 在 `N²` 规模做 dedup 合并 · stable id 必须穿透 · bootstrap 必须分路 · 任何一个环节坑就爆。换一种说法:delta-send 是个**实现约束**伪装成了**架构决策**。

### 4. 分支 / 重玩 / 跨模型 context rebuild 做不动

MessageRepo 没有 DAG(父子 parent_id)· checkpointer 的 state 是 model-neutral 的 snapshot · 用户"从这条消息分支出去"或"换个模型重算"这两个 feature,当前模型下都要专门设计 —— 不是一行代码能加的。

### 5. Claude Code 的参考答案就在仓库里

`ref-src-claude/` 是 Anthropic 自己 agent CLI 的全量实现。它用**单一 append-only JSONL 事件日志**解决了以上所有问题:

- 事件日志是唯一 SoT(`{sessionId}.jsonl` · 见 V11 § 2.1)
- LLM 上下文是**每轮重新计算**的纯函数投影(`normalizeMessagesForAPI` · V02 § 2.1)
- 每轮发全量(`autoCompact` + 全量 prefix · V08 § 2.1) · 依赖 provider prompt caching 解决 cost
- 分支 / fork / resume 都是对事件日志做不同的遍历(`parentUuid` DAG · `applySnipRemovals` · `buildConversationChain` · `recoverOrphanedParallelToolResults`)
- Subagent 是独立 sidechain(`agent-{id}.jsonl`)
- Auto-compact 有熔断器 + PTL fallback(V08 § 2.2-2.3)

**这是一个 18 个月在 Anthropic 内部生产环境跑出来的 LLM agent 产品参考答案**,不是一个框架的 tutorial。

## Decision

**`allhands` 从今天起把 Claude Code(`ref-src-claude/`)作为首要架构参考**,用事件日志 + 纯投影模式替代"MessageRepo + Checkpointer + delta-send"的 dual-SoT 模型。

### 三个核心决策

**D1 · 单一 SoT = append-only 事件日志(`conversation_events` 表)**

对标:Claude Code `src/utils/sessionStorage.ts` 的 JSONL append-only transcript(`ref-src-claude/volumes/V11 § 2.1`)。

- 新表 `conversation_events` · schema 见 `plans/2026-04-24-claude-code-refactor.md` §2
- `EventKind` 覆盖 USER / TURN_STARTED / ASSISTANT / TOOL_CALL_{REQUESTED,APPROVED,DENIED,EXECUTED,FAILED} / TURN_COMPLETED / TURN_ABORTED / SKILL_ACTIVATED / SYSTEM / SUMMARY / INTERRUPT_RAISED / INTERRUPT_RESUMED / CONVERSATION_FORKED
- `parent_id` DAG 字段(默认指前一条 event · 分支时指向 fork 点)· 对标 Claude `parentUuid`
- `subagent_id` 字段 · subagent 独立 sidechain · 对标 Claude `agent-{id}.jsonl`
- `idempotency_key`(UNIQUE)· 客户端重试幂等
- `turn_id` · 同一 turn 的 events 分组

**D2 · LLM context = 纯函数 `build_llm_context(conv_id, model, runtime)` · 每轮重新投影**

对标:Claude Code `src/query.ts` 的 `normalizeMessagesForAPI`(`ref-src-claude/volumes/V02 § 2.1`)。

- 输入 conversation_id + model + runtime(skills / system_override)+ event_repo · 无隐藏 state
- 输出 `(system_prompt, messages)`· 纯函数 · 同样输入同样输出
- 职责:读事件日志 → 配对 tool_use / tool_result → 处理 TURN_ABORTED(注入合成 assistant message · 见 plan §1 B) → 处理 SUMMARY 替换 → 调 auto-compact → 合成 system_prompt(employee + skill descriptors + resolved fragments) → 注入 prompt caching 标注
- `AgentRunner.stream(system_prompt, messages, turn_id)` 只负责工具编排 + 流式转发 · 不管 history · 每 turn fresh `thread_id`

**D3 · 每轮发全量 + provider prompt caching(取代 delta-send · 取代 add_messages reducer)**

对标:Claude Code `src/services/compact/autoCompact.ts` 的全量发送模式 · `cache_control` 4 级(`ref-src-claude/volumes/V08 § 2.1` · [Anthropic prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching))。

- 每轮 build 出的 messages 是完整历史(或 auto-compact 后的等价 prefix)
- Anthropic 侧 `cache_control: {type: ephemeral}` 标注在稳定前缀(system prompt / tool manifest / summary)· 热轮除最后 N 条都被缓存 · 成本不随轮数线性涨
- OpenAI 侧自动缓存 · 无需改
- 不再依赖 `add_messages` reducer 的 id dedup · stable id 不再必须(仍保留以便 Observatory 追溯)

### 支持性决策

**D4 · LangGraph checkpointer narrowed 到 in-turn interrupt state**

- Checkpointer 继续用 · 但 `thread_id` 每 turn fresh(不再等于 conversation_id)
- 只承载"该 turn 里 interrupt 暂停点 + 恢复"语义 · turn 完成即可丢
- ADR 0014 R1(import-linter 守 `langgraph.checkpoint.*` 不泄出 `execution/`)继续生效
- ADR 0014 R2 的"两 SoT 互补切片"**语义进化**:MessageRepo 从"消息账本 SoT"降级为"事件日志到前端 API 的 projection cache";事件日志是真正的 SoT

**D5 · TURN_ABORTED 作为 event kind · 对齐 Claude 的 api_error/tool_use_error-as-message 模式**

- 对标 Claude Code `V02 § 1.3`:异常被**标准化为 transcript entry**(`api_error` / `tool_use_error`)· 不是特殊概念
- 我们的 TURN_ABORTED 承载 `reason`(user_superseded / stream_error / crash_recovery / concurrent_write_rejected)+ partial_content + human_friendly 描述
- `build_llm_context` 遇到 `[USER, TURN_ABORTED, USER]` 序列时,注入**合成 assistant message**,内容为 `human_friendly`(见 plan §1 B) · 保证 Anthropic user/assistant 交替契约 · 原始事件纹丝不动可审计

**D6 · Auto-compact 完整照抄 Claude-style**

- `MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000` 预留
- 阈值 = 模型窗口 - 20k summary - 13k buffer
- **熔断器**:连续 3 次 summarize 失败 → 停该 conv 的 autocompact · 防死循环
- **PTL fallback**:summary 自己 OOM → 剥 20% 老分组重试 · 最多 5 次
- 产出写 SUMMARY event · 被覆盖的老 events 打 `is_compacted=true` 标记但不 delete
- 对标 `ref-src-claude/volumes/V08 § 2.2-2.3`

**D7 · Subagent 独立 sidechain**

- `subagent_id` 字段过滤 · 父 conv build_llm_context 只读 `subagent_id IS NULL` · subagent 自己读自己的
- subagent 结果回父作为 TOOL_CALL_EXECUTED · 细节在 sidechain
- 对标 Claude Code `agent-{agentId}.jsonl`

**D8 · 分支 / 重玩 作为一级能力**

- `parent_id` DAG 是一级字段 · API `POST /conversations/{id}/branch?from_event_id=...` + CONVERSATION_FORKED event
- 对标 Claude Code `parentUuid` DAG + `buildConversationChain` 的分支处理

## Rationale

1. **与 Anthropic 自己的参考实现对齐**。Claude Code 是 18 个月生产环境证明的 LLM agent 架构,不是某个框架的 tutorial。用它作为首要参考 · 不让某个框架的默认做法绑架全局架构(L19)。
2. **消除 dual-SoT 一致性税**。单一事件日志 · 多个纯投影 · 每个投影的正确性独立验证 · 不再有"两份状态怎么同步"这类横切约束。
3. **让过去做不动的 feature 变成自然的**。分支(parentUuid DAG) · 跨模型 context rebuild(纯函数每轮重算)· clean recovery(事件日志遍历) —— Claude Code 的模型下这些是一级公民,不是补丁。
4. **Mental model 更简单**。一条 log · 多个投影 · 不再需要区分"MessageRepo 怎么写 vs checkpointer 怎么写 vs add_messages 怎么 dedup"。

## Consequences

### 正向

- **E26 类 bug 根治**。非连续 system message 的可能性由 build_llm_context 的纯函数性质排除 —— 每轮从事件日志重新组装 · 没有持久化的 message state 可以漂。
- **Dual-SoT 漂移不可能发生**。`messages` 表降格为 projection cache · 任何时候不一致都可以直接从事件日志重算。
- **分支 / regenerate / fork 变成 API 级的简单操作**。parent_id DAG + 新 conversation_id · 不需要特殊 reducer 逻辑。
- **Auto-compact 不再对 LLM 撒谎**。SUMMARY 是事件日志里的一条 event · 投影时替换被覆盖的老 events · 前端可以同时看账本 + 原始事件 · LLM 看到的是 summary + tail。
- **Subagent / parallel tool 的正确性更清晰**。sidechain 和 parallel tool_use_id 配对都是事件日志遍历的自然结果 · 不需要在 state reducer 里塞规则。

### 负向

- **Schema migration 需要**(`conversation_events` 新表 + 遗留 `messages` 一次性 replay 转换 · P1.E)。
- **每轮重算 context 的 CPU 开销**。纯函数 · 可 cache · Phase 3 prompt caching 让 provider 侧的 cost 不随轮数增长 · 本地 CPU 开销忽略。
- **依赖 provider prompt caching 对成本效率**。Anthropic 上必须开启 `cache_control`(Phase 3.C) · 否则大对话的 token 成本会线性涨 · 但这是单点开关 · 不是架构复杂度。
- **Turn lock 新增复杂度**。并发写保护需要 per-conversation asyncio.Lock(Phase 2.A) · Phase 4.B 升级为 Postgres advisory lock。

### 取代 / 演化

- **Supersedes ADR 0014 R3**(delta-send 契约)· 明确替换为**每轮发全量 + prompt caching**。相关回归测试 `test_dual_sot_stable_ids.py` / `test_delta_only_send.py` / `test_cold_start_replay.py` / `test_dual_sot_delta_consistency.py` 在 P1 落地后全部作废 · 由新的事件日志 / 投影 / turn-abort 测试取代。
- **ADR 0014 R1 继续生效**(import-linter 守 `langgraph.checkpoint.*` 不泄出 `execution/`)· Claude Code 模式下 checkpointer 仍在 execution 内部 · 边界不变。
- **ADR 0014 R2 演化**:MessageRepo 从"消息账本 SoT"降为"事件日志 → 前端 API 的 projection cache" · 事件日志成为唯一 SoT · R4(checkpointer 不替代 SkillRuntimeRepo / ConfirmationRepo / ArtifactRepo)仍然成立。
- **原则 3(Pure-Function Query Loop)扩展**:runner 的纯函数性质扩展到整个 context 构建(`build_llm_context`) · runner 自己从"输入 lc_messages 计算"变成"只做工具编排"。
- **原则 7(状态可 checkpoint)演化**:checkpoint 的粒度从"跨 turn conversation state"收窄到"in-turn interrupt snapshot" · 跨 turn 的可恢复性由事件日志承担。

## Alternatives rejected

### A0 · 保持 dual-SoT + delta-send(现状)

- **Pros**:零工作量 · 刚落地完
- **Cons**:E26 类 bug 的可能性仍在(任何一个偷偷往 messages 通道塞 SystemMessage 的路径都重新炸) · LangGraph-specific 复杂度(add_messages reducer 语义)入侵业务代码 · 分支 / 跨模型 rebuild 没法做 · 每个新 feature 都付 dual-SoT 一致性税
- **为什么不选**:已经付了一次 ADR 0014 R3 的 delta-send 复杂度税 · 再付第二次是错上加错

### A1 · 纯 LangGraph · checkpointer 作为 message SoT(把 MessageRepo 干掉)

- **Pros**:单一 SoT · 心智简单
- **Cons**:前端 `render_payloads` / `tool_calls` 持久化结构破(E24 修过) · 跨模型 context rebuild 不可能(checkpoint snapshot 是 model-neutral 但 tokenizer / window 不是) · compaction 和 snapshot immutability 冲突 · LangGraph state schema 跟着 LangGraph 版本走 · 绑得太死
- **为什么不选**:checkpointer 是 graph 内部态的载体 · 不适合作为业务实体(消息账本)的 SoT · 见 ADR 0014 §4 的四条拒绝

### A2 · 事件日志但用 LangGraph 作唯一 reducer(事件 → graph state)

- **Pros**:理论上 LangGraph 帮忙收敛 state
- **Cons**:仍然要学 `add_messages` reducer 怎么在事件日志上行为 · stable id / dedup / tool_use+tool_result 配对这些逻辑分布在 LangGraph 和业务代码里两处 · 每次升级 LangGraph 都要回测
- **为什么不选**:这是"用 LangGraph 的方式投影事件日志" · 和"写纯 Python 函数投影"相比 · 后者对我们来说是零心智成本

## Related

- **ADR 0011 · Principles refresh** — 本 ADR 引入原则 8(参考系统) · 并演化原则 3 / 原则 7
- **ADR 0014 · LangGraph Checkpointer**(partially superseded) — R3 delta-send 契约被替换 · R1 import-linter 继续生效 · R2 演化为 projection cache 语义
- **ADR 0015 · Skill progressive loading** — skill runtime 激活时的 SKILL.md body injection 继续由 `resolved_fragments` 承载 · 本 ADR 不动 skill 加载路径
- **E26 · 非连续 system messages 累积 · provider 拒绝** — 根治机制见 D1 + D2
- **L19 · 不要被 LangGraph 抽象绑架** — 本 ADR 的方法论基石
- **ref-src-claude** — `V02`(execution kernel · normalizeMessagesForAPI · api_error-as-message)· `V08`(context management · autoCompact · circuit breaker · PTL fallback)· `V11`(session persistence · JSONL append-only · parentUuid DAG)
- **plans/2026-04-24-claude-code-refactor.md** — 落地计划 · Phase 1-4

## Regression defense

本 ADR 的契约由 plan P1-P4 的测试套件守护(随实施逐条落地):

**Phase 1(Foundation)**:
- `backend/tests/unit/test_conversation_event_repo.py` · append 保序 · 幂等 UNIQUE · parent_id 约束 · orphan turn 扫描
- `backend/tests/unit/test_build_llm_context.py` · property-based 纯函数性(两次调用同结果无副作用) · 基础 USER/ASSISTANT/TOOL/SYSTEM 投影
- `backend/tests/integration/test_turn_abort_projection.py` · S1-S5 五种中断 case 的合成 assistant message 注入
- `backend/tests/integration/test_event_log_sot_consistency.py` · messages 表作 projection cache · 与事件日志 diff = 0
- `backend/tests/integration/test_legacy_conversation_replay.py` · 遗留 conversation 一次性迁移

**Phase 2(Correctness)**:
- `backend/tests/integration/test_turn_abort_user_superseded.py`(S1/S2)
- `backend/tests/integration/test_turn_abort_stream_error.py`(S3)
- `backend/tests/integration/test_turn_abort_concurrent_write.py`(S4)
- `backend/tests/integration/test_turn_abort_crash_recovery.py`(S5)
- `backend/tests/integration/test_autocompact_circuit_breaker.py` · 3 次失败熔断
- `backend/tests/integration/test_autocompact_ptl_fallback.py` · OOM 剥老分组重试
- `backend/tests/integration/test_tool_call_granular_events.py` · 1 assistant + 3 requested + 3 executed · 7 条事件
- `backend/tests/integration/test_consecutive_user_dedup.py`(P2.D · 兜底 merge)

**Phase 3(Features)**:
- `backend/tests/integration/test_subagent_sidechain.py` · 主 conv 看不到细节 · sidechain 完整
- `backend/tests/integration/test_branch_api.py` · branch 后 events replay ≡ fork 点前
- `backend/tests/integration/test_prompt_caching_markers.py` · cache_control 只加在稳定前缀
- `backend/tests/integration/test_recovery_snip_chain.py` · 删消息后 parentUuid 重连
- `backend/tests/integration/test_parallel_tool_result_recovery.py` · 缺失 tool_result 占位补全

**Phase 4(Scale)**:
- Postgres 上 integration test 全绿
- `backend/tests/integration/test_concurrent_tab_advisory_lock.py` · 晚到 409 · 抢占后老连接 TURN_ABORTED

**静态契约**(现有继续生效):
- `uv run lint-imports` · `langgraph.checkpoint.*` 不泄出 `execution/`(ADR 0014 R1)
- `core/` 禁止 import `langgraph` / `langchain` / `sqlalchemy` / `fastapi`(原则 7)

## Status log

- **2026-04-24** · Proposed · 用户第 4 问暴露 turn abort 架构空缺 · 讨论后确认向 Claude Code 模式全面迁移
- **2026-04-24** · Accepted · plan `2026-04-24-claude-code-refactor.md` v2 approved · Phase 1-4 落地中
