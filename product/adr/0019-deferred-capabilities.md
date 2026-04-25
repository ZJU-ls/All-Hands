# ADR 0019 · Deferred Capabilities · Plan Tool · Sub-Agent Stream-Through · Clarification

**日期:** 2026-04-25  **状态:** Accepted, impl in progress (Phase C)
**Builds on:** [ADR 0018 · Claude Code Loop](0018-claude-code-loop.md) · [ADR 0011 · Principles Refresh](0011-principles-refresh.md)

---

## Context

ADR 0018 落地后 · `DeferredSignal` ABC 是一等公民原语 · `ConfirmationDeferred` 是首个 impl · ADR 0018 §C 留了 4 个未来能力的 anchor:plan mode / sub-agent stream-through / clarification / 长任务。

读完真实 Claude Code TS 源码(`/Volumes/Storage/code/claude-code-analysis/src/`)后,发现:

1. **基础设施 70% 已存在**:`core/plan.py`(AgentPlan + PlanStep)、`SqlAgentPlanRepo`、4 个 plan tool 声明、`PlanCard.tsx` / `PlanTimeline.tsx` 组件、`RunTraceDrawer.tsx` + `?trace=<run_id>` 路由 — 全部已有。**核心缺口是 plan tool 的 executor(注册了 no-op stub)和子 agent 的实时流式 yield。**
2. **用户反馈**(2026-04-25):
   - Plan 不要做成 mode(无 enter/exit 仪式 · 无权限 gating)· 做成普通 tool · agent CRUD · 用户在 UI 看到。
   - 子 agent 加详情可视化 · ToolCallCard 加按钮 · 右侧 drawer 弹出。
   - **权限管理后期再审查 · v0 以功能为主。**

---

## Decision

实施 Phase C · 三个延迟能力 · **基于现有基础设施 + ADR 0018 5 公理 · 不引入新原语**:

### C1 · Plan as a Tool(轻量)

**Plan 是 agent 的内部 memo · scope=WRITE · requires_confirmation=False**(不动外部系统,不需要确认)。

- 4 个 meta tool 已经声明:`plan_create` / `plan_update_step` / `plan_complete_step` / `plan_view`
- Phase C1 补齐 executor(新文件 `execution/tools/meta/plan_executors.py`)
- AgentLoop ctor 加 `plan_repo: AgentPlanRepo | None = None` + `conversation_id: str = ""`
- `_maybe_substitute_executor` 加 4 分支(类似现有 skill / dispatch 的 substitution)
- `plan_view` 返回 `{component: "PlanTimeline", props: {...}, interactions: []}` envelope · 现有 `_as_render_envelope` 自动检测 · 触发 `RenderEvent`

**显式不做的事**(对照 Claude Code 的 EnterPlanMode 模型):
- ❌ **没有 plan mode** · 不引入 `Conversation.permission_mode` 字段
- ❌ **没有权限 gating** · 任何时候 agent 都能调 plan tools(包括 plan_view)
- ❌ **没有 enter/exit 仪式** · 直接 CRUD

**为什么不做:** 用户原话 — "权限管理可以不要这么严格 · 权限我最后再审查添加 · 我们现以功能为主"。Plan as memo 是更直接的产品语义 · permission mode 的复杂度可以延后(如果将来确实需要 read-only design phase,再回头加)。

### C2 · Sub-Agent Stream-Through + Trace Drawer

**两件事同时做:**

**A. 后端流式**:`Tool` 模型加 flag `streams_events: bool = False`。`dispatch_employee` / `spawn_subagent` 设为 `True`。AgentLoop 在执行时检测 flag · executor 返回 async generator(而非 dict)· 父 loop yield-through 子 `InternalEvent`(给每个事件加 `subagent_id` 注解)· 最后一个 yield 是 `ToolMessageCommitted`(终态 · 含 `run_id`)。

**B. 前端 Drawer**:`ToolCallCard` 在 expand 区检测 `result.run_id` 是否存在 · 渲染 "查看子代理细节 →" 按钮 · 点击 `router.push("?trace=<run_id>")` · 现有 `RunTraceDrawer` 监听 URL 自动滑出 · 现有 `RunTracePanel` 拉细节渲染。

**核心:** AGUI 协议层加一个可选 `subagent_id` 字段 · 现有 wire 协议保持兼容(老消费者忽略未知字段)· **新事件类型零新增**。

### C3 · Clarification (`ask_user_question`)

**全新能力 · 复用 P2 deferred 原语:**

- 新 `UserInput` core model + `UserInputRepo` + alembic migration
- 新 `UserInputDeferred(DeferredSignal)` impl(第二个 DeferredSignal · 验证原语通用性)
- 新 `Tool.requires_user_input: bool = False` flag
- 新 `ask_user_question` 内置 tool · `requires_user_input=True` · scope=READ · 无 confirmation
- AgentLoop `_permission_check`:`requires_user_input=True` → `Defer(UserInputDeferred)`
- `tool_pipeline.execute_tool_use_iter`:`outcome.kind == "answered"` 时把 `outcome.payload`(answers dict)merge 进 `block.input` · 再 invoke executor
- `ag_ui_translator` 加 `allhands.user_input_required` custom event
- HTTP `POST /api/user-input/{id}/answer` body `{answers: dict}` · 翻 row 到 ANSWERED
- 前端 `UserInputDialog.tsx` 多问题表单 dialog
- TTL = **600s**(10 分钟用户思考时间 · 比 confirmation 的 300s 长)

---

## Rationale

### 为什么这三个一起

读 Claude Code 源码后明确:**这三个特性都是同一组底层原语的不同应用**。我们 ADR 0018 已经把原语做对了 · Phase C 是验证原语的能力(deferred / generator-yield-through / disk-persistence-via-repo)。

特别是 C3 是 `DeferredSignal` 的第二个 impl —— 第一个是 ConfirmationDeferred · 第二个验证了"问用户问题"和"等用户审批"用同一段代码。这是 ADR 0018 axiom A4(deferred tool 一等公民)的代码级证明。

### 为什么不做 plan mode

三层考虑:

1. **YAGNI**:用户没有要求只读探索阶段 · 当下产品形态没有这个需求场景。
2. **复杂度**:plan mode 引入 conversation.permission_mode + permission gating + system prompt 切换 + enter/exit 仪式工具 · 每一项都有边界条件。
3. **可逆性**:如果后期发现需要,可以回头加 —— 加是局部改动 · 现在不加不锁死任何东西。

CLAUDE.md §3.2 禁了 Conversation.mode 枚举字段 —— plan mode 名义上是"运行时 flag"不是"agent mode 枚举",但灰色地带。延后做避免为灰色地带辩护。

### 为什么子 agent 默认开流式

老 `dispatch_employee` 调用者(目前主要是 Lead Agent)对子 agent 的可见性是 0 · 只能等最终结果。开流后:

- Lead 看不见多余信息(它读不到自己流出去的事件 · 流给前端)
- 前端渲染从"空白等待 N 秒" → "实时看到子 agent token + tool call"
- ToolCallCard 用 expand 区收纳 · 不展开就看不到 · 用户主动展开才看
- run_id 锚点稳定 · 失败可以追溯

向后兼容:子 agent 的 `ToolMessageCommitted` 终态(`result` dict)依然是老调用者期待的 shape · 中间事件多了不影响下游消费。

### 为什么 TTL 600s

confirmation 是"快速二选一"(approve / reject)· 300s 够。clarification 是"思考型回答"(选 1-of-4 + 可能写 notes)· 600s 给用户充裕思考时间。极端情况(用户离开屏幕)· EXPIRED 状态被 LLM 看到 · 可以重新问。

---

## Consequences

### 收益

1. **Plan 立刻可见可用**:agent 主动维护 todo · 用户实时看进度 · "黑盒 agent" 心智压力降低
2. **子代理细节可探查**:ToolCallCard 一键深入 · 失败时定位问题成本降低
3. **澄清能力**:agent 不再"瞎猜用户意图" · 拿不准时主动问 · 提高首轮命中
4. **DeferredSignal 第二个 impl**:验证 ADR 0018 axiom A4 通用性 · 为未来"长任务等待""sub-agent 完成等待"等 deferred 用法奠基
5. **老代码不动**:plan tool 的声明 / PlanCard / RunTraceDrawer / RunTracePanel / fetchRunDetail / parent_run_id · 全部复用 · 工作量小

### 代价

1. **Plan 没有权限保护**:agent 在任何 mode 都能调 plan_create —— 这是当下设计选择。万一发现"agent 在不该调 plan 的时候调了"再加 gating(成本可控)。
2. **Sub-agent 流式增加事件量**:深度 3 的子 agent 链 · 事件量按指数增长(但通过 subagent_id 注解 · 前端可以折叠)。
3. **C3 全新代码路径**:UserInputRepo + UserInputDeferred + UserInputDialog · 新表 · 新组件 · 第一次接的时候要谨慎集成测试。

### Risks & Mitigations

| 风险 | 缓解 |
|---|---|
| Plan tool 被 agent 滥用(每个小动作都更新 plan)| 工具描述明确"only major milestones, not micro-steps" · 如果还是有问题再细化 schema |
| 子 agent 流式干扰当前 ToolCallCard 渲染 | UI 把 subagent_id 不为空的事件折叠到对应 ToolCard 内 · 默认 collapsed · 老视图不变 |
| UserInputDeferred 死锁(用户永不答)| 600s TTL · expired 被 LLM 当 "用户没回答" 处理 |
| ask_user_question 被 LLM 滥用(每轮都问)| 工具描述强调 "ask only when truly ambiguous, not for every step" |

---

## Alternatives Considered

### Alt 1 · 完整 Claude Code 风格 plan mode

implement EnterPlanMode + ExitPlanMode · permission_mode 字段 · 系统 prompt 切换 · permission gating。

**拒绝原因:** 用户明确反馈"权限管理可以不要这么严格 · 我们现以功能为主"。复杂度不值。

### Alt 2 · 子 agent 不开流式 · 只在 ToolCallCard 加按钮

只做前端按钮 · 不做后端流式回流。

**拒绝原因:** 子 agent 跑 30s 期间 ToolCallCard 是 "running..." · 用户完全黑盒。流式回流的成本只是几行 yield-through 逻辑 · 收益大。

### Alt 3 · Clarification 走 confirmation 通道(复用 ConfirmationRepo)

ask_user_question 复用 ConfirmationRepo,只是 status 多一个 ANSWERED · payload 存 answers。

**拒绝原因:** 语义混淆(confirmation 是 yes/no · clarification 是结构化答案)· payload schema 完全不同 · 复用让两边都难维护。新 UserInputRepo 是 ~120 LOC · 不痛。

---

## Migration Plan

详见 `docs/superpowers/plans/2026-04-25-phase-c-deferred-features.md`。14 task · 4 阶段 · ~4.5 天:

- **C0**(本文)· ADR + 计划锁定
- **C1** · Plan tool executors · 3 task
- **C2** · Sub-agent stream + trace drawer · 4 task
- **C3** · Clarification · 4 task
- **C4** · 验证 + 文档同步 · 2 task

**并行调度**:C0 之后 dispatch 3 个 subagent 独立做 C1/C2/C3 · review + integration · C4 收尾。

---

## References

- 真实读源码:`/Volumes/Storage/code/claude-code-analysis/src/`
  - `tools/EnterPlanModeTool/EnterPlanModeTool.ts:77-94` · plan mode 设计参考(我们做了 lighter version)
  - `tools/AgentTool/runAgent.ts:248-329, 748-806` · sub-agent yield-through 模式
  - `tools/AskUserQuestionTool/*` · clarification 模式
- ADR 0018 · 5 公理 · DeferredSignal 原语 · 本 ADR 应用层
- ADR 0011 · 原则 5 Subagent · 本 ADR 兑现"复用 AgentLoop, 不写第二条 agent 路径"
- 实施计划 · `docs/superpowers/plans/2026-04-25-phase-c-deferred-features.md`
- 速读 HTML · `docs/diagrams/phase-c-plan.html`
