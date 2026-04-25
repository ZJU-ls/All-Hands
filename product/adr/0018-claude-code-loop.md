# ADR 0018 · Claude Code 风格 Query Loop · 移除 LangGraph Orchestration 层

**日期:** 2026-04-25  **状态:** Accepted, impl in progress
**Supersedes:** [ADR 0014 · LangGraph Checkpointer](0014-langgraph-checkpointer.md)
**Related:** [ADR 0011 · Principles Refresh](0011-principles-refresh.md) · [ADR 0017 · Event-Sourced Claude Code Pattern](0017-event-sourced-claude-code-pattern.md) · [ADR 0010 · AG-UI Protocol](0010-ag-ui-protocol-adoption.md)

---

## Context

ADR 0017(2026-04-24)已经把"参考系统优先级"明文锁死了:**Claude Code(`ref-src-claude/`)是首要架构参考 · LangGraph / LangChain 等框架仅作"工具编排 + interrupt 原语"等局部引擎使用 · 不作消息历史 / resume / subagent / 压缩的 SoT**。

但代码层的现状没追上文档:`backend/src/allhands/execution/runner.py` 仍然依赖 `langgraph.prebuilt.create_react_agent` + `langgraph.checkpoint.AsyncSqliteSaver` + `langgraph.types.interrupt()` 三件套。这个组合产生了几个具体问题:

### 问题 1 · 协议层的"幽灵 tool_call" bug

LangGraph `stream_mode="messages"` 是逐 chunk 流。`runner.py:696-712` 的逻辑:

```python
raw_tcs = getattr(msg, "tool_calls", None) or []
for tc in raw_tcs:
    tc_id = tc.get("id")
    if not tc_id or tc_id in seen_tool_call_ids:
        continue
    seen_tool_call_ids.add(tc_id)
    yield ToolCallStartEvent(...)
```

中间 chunk 的 `AIMessageChunk.tool_calls` 是 LangChain 从 `tool_call_chunks` **累加计算**出来的 —— 只要某个中间 chunk 里出现了 `{id, name}`,这个属性就立刻有一项。但 `create_react_agent` 决定走 tools 节点是看**最终合并的 AIMessage**,不是中间 chunk。

实战表现(2026-04-25 用户实测,gpt-4o-mini):模型流出"我现在帮你创建..."(text) → 流 `tool_call_chunks { id: X, name: artifact_create }`(`tool_calls` 属性出现一项) → 模型继续流文字、未提交 tool_call → 最终消息无 tool_calls。runner 已发 ToolCallStart,tools 节点没跑,ToolCallEnd 永远不来,UI 卡 pending(已通过 `de6deef` belt-and-suspenders 修了表层,根因未除)。

### 问题 2 · 强行用 `interrupt()` 做暂停 · 与 polling-gate 双轨并行

`gate.py` 现在两套实现:`InterruptConfirmationGate`(ADR 0014 Phase 4c · 用 `lg_interrupt`)+ `PersistentConfirmationGate`(ADR 0014 之前 · 写 DB + 轮询)。`deps.py:121-136` 在两者之间二选一,逻辑是"有 checkpointer 时用前者,否则后者"。

这导致:
- chat_service.resume_message(`chat_service.py:592-691`)100 行专门处理 LangGraph 的 `Command(resume=...)` 路径
- 前端有"接到 confirm_required → 关 SSE A → POST /resume → 开 SSE B"的双流路径
- INTERRUPT_RAISED / INTERRUPT_RESUMED 两个 EventKind + 在 `_persist_assistant_reply` 里的事件查找和写入

而 polling 路径(`PersistentConfirmationGate.request`,gate.py:148-214)其实**已经有完整能力做同一件事**:写 row → 轮询 → 用户翻 status → 协程下个 tick 看到 → 返回。它甚至已经在生产路径上(无 checkpointer 时 fallback 用)。

### 问题 3 · `create_react_agent` 即将再次迁移

```
LangGraphDeprecatedSinceV10: create_react_agent has been moved to
`langchain.agents`. Please update your import to
`from langchain.agents import create_agent`. Deprecated in LangGraph V1.0
to be removed in V2.0.
```

这是测试运行时的真实警告(`tests/unit/test_runner.py` 已观察到)。我们要么跟着迁,要么撤。

### 问题 4 · 未来 4 个能力都没有清晰 anchor

allhands 的 v1 路标里有四个 deferred 能力:
- **计划**(plan mode)· Lead Agent 进入 plan-only 状态 · 产出 plan 后 user 批准再执行
- **子代理调度** · `dispatch_employee` / `spawn_subagent` · 当前只回最终结果,未来要 stream-through 子事件
- **问题澄清** · agent 主动问用户 · 等用户回答 · 继续
- **审批确认** · 已实装(就是当前的 confirmation 流程)

这四个能力**形态完全相同** —— "tool 执行中途挂起、等外部信号"。当前架构下每加一个就要在 LangGraph 层(interrupt route / Command resume)+ chat_service(resume path)+ 前端(双流)各加一套。**线性成本爆炸。**

### 用户在评审中给出的方向

2026-04-25 用户原话:

> "我建议参考 claude code,只是前端渲染协议上可以做适配层,使用 AGUI,但是我觉得你应该学到了核心思想,就是所有的能力其实是围绕 tool 构建的,这个可以作为你的基本思考沉淀下来。"

> "面向终态设计和实现而不是面向时间和 token 设计和实现。"

读完真实 Claude Code TypeScript 源码(`/Volumes/Storage/code/claude-code-analysis/src/`,9000+ 行)后,这条方向被验证 —— Claude Code 的整套架构就是这两条原则的产物。

---

## Decision

**用一个 `AgentLoop` 类替代 `create_react_agent` + `AsyncSqliteSaver` + `interrupt()` 三件套。** `AgentLoop` 是纯 async generator,基于以下 5 条架构公理设计:

### 5 条公理(后续设计基线)

1. **没有平行运行时状态机。** "等外部信号"语义全部经由 deferred tool 表达。loop body 永远是同一个 while-true。
2. **State 终态化。** `Conversation = (messages, conversation_mode, repos)` · 任何运行时状态都能从这三者完整重建 · 没有内存里藏的状态。
3. **AG-UI 是 SSE 边界的 wire-protocol 适配器,不是内部 SoT。** `execution/` 和 `services/` 发出按 Claude Code 形态(Message commit + preview delta)定义的内部事件 · `api/ag_ui_translator.py` 在出口翻译。
4. **Deferred tool 是一等公民。** Tool execution pipeline 必须显式支持"挂起等外部信号 channel · 唤醒"。这一个原语承载 confirmation / clarification / sub-agent / plan mode / 长任务。
5. **Tool-as-everything。** 任何今天看起来需要并联 `Service` / `Gate` / `Interrupt` 路径的能力,起手先问"能做成 tool 吗"。新需求默认"是个可能 defer 的 tool"。

### 关键设计组件

#### A. 内部事件协议 · 双层

**Terminal events**(持久化 · 驱动状态 · 服务层消费 · 翻译给 AG-UI):
- `AssistantMessageCommitted(message)` —— 一条 immutable assistant 消息封板,包含 `content_blocks: list[TextBlock | ToolUseBlock | ReasoningBlock]`
- `ToolMessageCommitted(message)` —— 一条 tool_result 封板,带 `tool_use_id`
- `ConfirmationRequested(...)` —— 等外部输入
- `LoopExited(reason)` —— `completed | max_iterations | aborted | prompt_too_long | stopped_by_hook`

**Preview events**(临时 · UX 提示 · 不持久化 · 不变更状态):
- `AssistantMessagePartial(message_id, text_delta, reasoning_delta)`
- `ToolCallProgress(tool_use_id, args_delta)`

**翻译边界:** `api/ag_ui_translator.py` 把内部事件映射为 AG-UI wire 事件。`execution/` 不直接 import AG-UI 类型(import-linter 守)。

#### B. Tool Execution Pipeline · 唯一一条路

```
ToolUseBlock from AssistantMessage
    ↓
validate (schema · scope · mode-allowed)
    ↓
permission_check → Allow(executor) | Defer(signal, ...) | Deny(reason)
    ↓
maybe_defer (only if Defer)
    signal.publish() → emit ConfirmationRequested → signal.wait() → outcome
    ↓
execute (if approved/Allow) | skip (if rejected/expired/Deny)
    ↓
record · ToolMessage(tool_use_id, content)
```

**所有 tool 走同一条流水线**。`maybe_defer` 是统一暂停点。Confirmation / clarification / "等子 agent" / "等长任务" 全部从这里入口。

#### C. DeferredSignal · 一等公民原语

```python
class DeferredSignal(ABC):
    @abstractmethod
    async def publish(self, **kwargs) -> DeferredRequest: ...
    @abstractmethod
    async def wait(self, req: DeferredRequest) -> DeferredOutcome: ...
```

实装:
- `ConfirmationDeferred`(本 ADR 实装)· 写 ConfirmationRepo 行 · 轮询 status
- `UserInputDeferred`(后续 · plan mode + clarification 共用)
- 子 agent 通过递归调 `AgentLoop.stream()` 的 generator,语义同构

#### D. Tool 并发分组(复刻 Claude Code `partitionToolCalls`)

```python
def partition_tool_uses(uses, registry) -> list[Batch]:
    """连续 read-only(scope=READ ∧ ¬requires_confirmation)合一个并发批
    任何 write/deferred tool 单独一批 · 顺序保留"""
```

批内 `asyncio.gather` · 但 ToolMessageCommitted 按输入顺序 emit 到流(deterministic transcript)。批间串行 await。

### 与 ADR 0014 的关系

ADR 0014 引入 LangGraph checkpointer 是 v1.1 的正确决定 —— 当时假设 graph state 需要框架持久化层。本 ADR 之后这个假设不成立:state 全部走 MessageRepo / ConfirmationRepo / SkillRuntimeRepo,checkpointer 没什么可存的。

ADR 0014 文档保留(标 superseded),代码层 `AsyncSqliteSaver` 在 Phase B5 移除。

### 与 ADR 0017 的关系

ADR 0017 锁定方向:Claude Code 是首要参考。本 ADR 是把这个方向**落到代码**。事件源 / pure-function loop / message-as-SoT 的语义和 0017 §核心断言一字不差。

---

## Rationale

### 为什么不能继续在 LangGraph 上"打补丁"

幽灵 tool_call 的根因是"chunk-level 决策 vs message-level 路由"的错位。这个错位是 `create_react_agent` 的内部设计 —— graph 路由用最终 AIMessage,但 stream_mode 流的是中间 chunk · 我们写 runner 时只能拿到 chunk-level 数据。要从外部修就必须做 "delay + reconcile"(belt-and-suspenders),这是用更多复杂度补 framework 的设计选择。

### 为什么自己写 loop 反而是简化

读 `claude-code-analysis/src/query.ts:200-260` 真实代码:

```typescript
type State = {
  messages: Message[]
  toolUseContext: ToolUseContext
  ...
}

while (true) {
  // 1. 一轮 LLM 完整往返
  const fullMessage = await streamAndAccumulate(model, messages)
  // 2. 提取 tool_uses 从已完成的 assistant 消息
  const toolUses = fullMessage.toolUses
  if (toolUses.length === 0) return { reason: 'completed' }
  // 3. 执行 + 收集 tool_results
  const toolResults = await runTools(toolUses)
  messages.push(fullMessage, ...toolResults)
}
```

实际 loop 主体不到 30 行。复杂度全在 `runTools`(并发分组 / permission / streaming executor),而那部分本来就要写 —— `create_react_agent` 也不替我们写。

### 为什么 deferred tool 一个原语就够

Claude Code 对应实现(`shouldDefer: true` flag + `canUseTool` hook):
- **Plan mode**: `EnterPlanModeTool.ts:77-94` 翻一个 `mode: 'plan'` flag,permission rules 按 mode 过滤
- **Clarification**: `AskUserQuestionTool` 是 `shouldDefer: true` 的普通 tool
- **Sub-agent**: `runAgent()` 是个 `AsyncGenerator<Message>` · 父 loop 把子 yield 直接接到自己的 stream
- **Approval**: `canUseTool` hook · 返回 `{ allowed: false, reason: 'needs_approval' }` · UI 弹对话框 · channel 喂 `PermissionResult`

四个能力,**零运行时状态机**。语义复用同一个"tool 内部 await 外部信号"原语。这是设计简洁性的硬证据。

### 为什么 AG-UI 不能是 internal SoT

AG-UI 是按"前端渲染需要的 wire 事件"设计的(TOOL_CALL_START / TOOL_CALL_ARGS / TOOL_CALL_END / RUN_FINISHED 等)。这套事件适合驱动 React 组件,但不适合做内部状态机:
- TOOL_CALL_START 没"重试"语义 · 内部如果要在 phantom 后撤销,得发个反向事件 → 前端要处理状态回卷 → 不优雅
- TOOL_CALL_RESULT 不区分 succeeded/rejected/expired/failed —— 仅靠 content payload 区分,内部状态机要解析 content 才能 dispatch

把"内部真理事件"和"前端 wire 事件"分开,各自演化,中间放一个翻译层 · 是常规做法。

### 为什么 Tool-as-everything 比 Tool First 强

CLAUDE.md §3.1 的 Tool First 说"用户能做的平台都得有 Meta Tool"(覆盖外向能力)。本 ADR 把它扩到"agent 内部能做的也都是 tool"(覆盖内向机制)。两者合一,统一了运行时 —— 运行时只有一种东西,叫 tool;只有一种 lifecycle,叫 deferred tool;只有一种状态,叫 message + mode + repos。

---

## Consequences

### 收益(Benefits)

1. **协议级消除幽灵 tool_call**。ToolUseBlock 只在 AssistantMessageCommitted 里出现 —— 在那之前,tool_use 概念**不存在**于系统。
2. **未来 4 个能力清晰 anchor**:plan mode / clarification / sub-agent / 长任务全部走 `permission_check → Defer(...)` 同一条路。
3. **删除 ~600 行代码**:InterruptConfirmationGate · Command(resume) 路径 · INTERRUPT_RAISED/RESUMED 事件查找 · `chat_service.resume_message` 现状版本 · `test_checkpointer_phase1.py` · `test_interrupt_resume.py`。
4. **Dep tree 收紧**:`langgraph` + `langgraph-checkpoint-sqlite` 移除。LangChain leaf primitives(BaseChatModel adapters / message types / StructuredTool)保留。
5. **Token streaming 不退化**(B6 Task 22 显式 bench · 回归 ≥10ms 不合并)。
6. **前端零改动**(AG-UI translator 出兼容线协议)· 后续单独 PR 清理 dual-SSE。
7. **import-linter 加全局 forbid `langgraph`**:框架反向渗透从此被守住。

### 代价(Costs)

1. **失去 LangGraph 的"免费 subgraph composition"**。子 agent 用递归调 AgentLoop 实现 · 等价但需要自己写 stream-through。
2. **失去 LangSmith 集成**(已经在 LangFuse,实际收益 0)。
3. **Resume 协议显式自有**。当前是 polling-based(已实装),未来若要事件驱动唤醒(asyncio.Event-based)需要自己加。
4. **Tool concurrency partition 自己写**(~30 行 + tests)。
5. **Recovery 策略自己设计**(prompt-too-long auto-compact 等)· 本 ADR 留 5 种 LoopExit reason 作 anchor,具体 recovery 不在本 PR 实装。

### Risks & Mitigations

| 风险 | 缓解 |
|---|---|
| 自己写 loop 边界 case 漏(如 max_tokens 重试 / context overflow) | LoopExited 5 种 reason 是显式扩展点 · `recovery → continue` 模式留好 anchor · v1.1 不实装 recovery 但留位置 |
| 子 agent 取消传染 | `asyncio.wait_for` 包子 loop · CancelledError 透传成 `LoopExited(aborted)` · Task 12 显式测试 |
| 子 agent message 流回父 stream 没设计 | 本 PR 不做 stream-through(open question 3)· 当前 `dispatch_employee` 行为保留 · 未来单独 ADR 设计 |
| AG-UI translator 错过某个事件 → 前端漏渲染 | Task 14 加 wire-output diff 测试比对 legacy · 翻译完整性回归 |
| Recovery 缺失 → token 超限直接 LoopExited | 5 reasons 中显式列出 prompt_too_long · v1.1 直接 LoopExited 不重试 · v1.2 ADR 单独设计 reactive compact |

---

## Alternatives Considered

### Alt 1 · 在 LangGraph 上写自定义 single-node graph

保留 LangGraph 当 substrate,自己写一个 StateGraph 节点替代 create_react_agent。

**拒绝原因:** 还是被 framework 锁着 —— stream_mode 解码 / langgraph_node 过滤 / Command(resume) / checkpointer 都还在。复杂度只降 30%,framework 风险一点没减。

### Alt 2 · 迁移到 `langchain.agents.create_agent`

跟随 LangGraph V1.0 deprecation 迁移。

**拒绝原因:** 同样的 framework 决策权问题。`langchain.agents` 自己也在迭代,几个月后又要迁。我们的路线本来就要离开 framework,不在迁移上耗。

### Alt 3 · 维持现状 + Phase A belt-and-suspenders 永久化

幽灵 bug 已经在 `de6deef` 表层修了(synthetic FAILED end + frontend finalize seal)。停在那里,不做 Phase B。

**拒绝原因:** Phase A 修的是这个 bug,但**没修这个 bug 类**。下一次 framework + provider 协议失配会再次以新形态出现(已经在 langchain V1.0 deprecation 警告里看到了)。架构债不还,还要继续付利息。

### Alt 4 · 完全脱离 LangChain(连 BaseChatModel 都换掉)

直接用 `anthropic` / `openai` SDK + 自己写 provider 抽象。

**拒绝原因:** LangChain leaf primitives 给我们的是真实价值(provider abstraction · message types · StructuredTool 的 schema 派生)· 这部分不是 orchestration 的 framework 风险所在。`langchain_core` 保留。

---

## Migration Plan

详见 `docs/superpowers/plans/2026-04-25-claude-code-loop-alignment.md`。23 个 task 跨 6 阶段:

- **B0** · ADR + 计划锁定(本文)
- **B1** · 内部事件 + Tool Pipeline + DeferredSignal · TDD 基础
- **B2** · AgentLoop 完整实装 · 7 个 task TDD 覆盖 text-only / tools / deferred / 并发 / 幽灵防御 / skill-dispatch-subagent / max-iter
- **B3** · AgentRunner 变薄壳 · AG-UI translator 接生产路径(feature-flagged)
- **B4** · InterruptConfirmationGate 退场
- **B5** · Checkpointer + LangGraph 一并退场 · runner.py 删除
- **B6** · 验证(9 个 E2E + token bench + 文档同步)

每阶段结束跑全套 `./scripts/check.sh` 才进下一阶段。每个 task 用独立 subagent 并行(独立模块的)或串行(有依赖的)推进。

前端清理(`pendingResumeRequest` + dual-SSE)单独 Phase B7,本 PR 后稳定再开。

---

## References

- 真实源码(读过)· `/Volumes/Storage/code/claude-code-analysis/src/`
  - `query.ts:200-260` · State shape + iteration pattern
  - `query.ts:1255-1360` · 5 LoopExit reasons
  - `services/tools/toolOrchestration.ts:91-116` · partitionToolCalls
  - `services/tools/StreamingToolExecutor.ts:19-32` · Tool status enum
  - `tools/EnterPlanModeTool/EnterPlanModeTool.ts:77-94` · plan mode = mode flag
  - `tools/AskUserQuestionTool/*.ts` · clarification = deferred tool
  - `tools/AgentTool/runAgent.ts:248-329` · sub-agent = recursive generator
- ADR 0014 · superseded · LangGraph checkpointer
- ADR 0017 · Claude Code 是首要架构参考 · 本 ADR 把方向落到代码
- ADR 0011 · Pure-Function Query Loop 原则 · 本 ADR 是其代码层完整实现
- 用户实测 · 2026-04-25 · gpt-4o-mini 触发幽灵 tool_call · screenshot in conversation
- 实施计划 · `docs/superpowers/plans/2026-04-25-claude-code-loop-alignment.md`
- 速读 HTML · `docs/diagrams/claude-code-loop-plan.html`(local: `http://127.0.0.1:8088/claude-code-loop-plan.html`)
