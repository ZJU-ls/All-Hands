# Agent Runtime Contract · 运转方式 preset + 动态 skill 注入 + subagent + plan 模式

**日期** 2026-04-19
**状态** Signed-off — Q6/Q7/Q9 delta applied 2026-04-19 (see § 12.4)
**产出方** Track M(I-0022)
**消费方** Track L(I-0021 · 员工设计页 UI)· 执行端 Phase 1+(本 track)
**位置** `docs/specs/agent-runtime-contract.md`(**顶层 spec** · 员工运转方式是整个 runtime 的契约级约束)

---

## 0 · 读本 spec 之前必读

1. [`CLAUDE.md`](../../CLAUDE.md) **§ 3.1 Tool First** · **§ 3.2 统一 React Agent(红线 · 禁 `mode` 字段)** · **§ 3.3 L4 对话式操作 + 护栏(Confirmation Gate)** · **§ 3.4 分层 import**
2. [`docs/issues/open/I-0022-dynamic-skill-injection-and-subagent.md`](../issues/open/I-0022-dynamic-skill-injection-and-subagent.md)(本 spec 驱动的 issue)
3. `ref-src-claude`(**本 spec 每个核心决策都引用** · 硬要求):
   - [`ref-src-claude/volumes/V02-execution-kernel.md`](/Volumes/Storage/code/ref-src-claude/volumes/V02-execution-kernel.md) · `query()` AsyncGenerator 主循环 · while(true) + break · 每轮 normalizeMessagesForAPI
   - [`ref-src-claude/volumes/V04-tool-call-mechanism.md`](/Volumes/Storage/code/ref-src-claude/volumes/V04-tool-call-mechanism.md) · Tool 运行时协议对象 · scope 声明 · `assembleToolPool` MCP 融合 · `partitionToolCalls` 分批
   - [`ref-src-claude/volumes/V05-skills-system.md`](/Volumes/Storage/code/ref-src-claude/volumes/V05-skills-system.md) · Skills 声明但不 pre-load · `getSkillDirCommands` memoize 发现 · 模型自主或 `paths` 条件触发
   - [`ref-src-claude/volumes/V10-multi-agent.md`](/Volumes/Storage/code/ref-src-claude/volumes/V10-multi-agent.md) · AgentTool 统一入口 · `runAgent()` 共享执行器 · in-process AsyncLocalStorage 隔离 · fork 复用父 prompt 字节保 cache · workerBadge 权限桥

---

## 1 · 背景 · 为什么要做这件事

### 1.1 现状

- [`backend/src/allhands/execution/skills.py:88 expand_skills_to_tools()`](../../backend/src/allhands/execution/skills.py) 在 employee bootstrap 时**一次性**把所有挂载 skill 的 `tool_ids + prompt_fragment` 展平到 `(tools[], system_prompt)` · 丢给 LangGraph `create_react_agent`
- 挂 10 skill(每 3-5 tool)的员工 → system message ~3000 token + 工具清单 30+ 个 → 弱 reasoning model(`qwen-turbo` / `qwen-plus`)"猪脑过载":工具乱调 / 偏题 / 丢 context
- 没有 `plan 模式`(不动工只出计划)· 没有 `subagent spawn`(主 agent 分解任务派活)

### 1.2 Claude Code 的答案(参考 `ref-src-claude/V05`)

- Skills **声明但不 pre-load**:`getSkillDirCommands()` 只做发现(memoize + realpath 去重)· SKILL.md 内容在**模型自主选择 `/<skill-name>` 时**才通过 `getPromptForCommand()` 展开
- Lead Agent 看到的是**轻量命令清单**(name + description + when_to_use)· 决定需要时由模型主动调用

### 1.3 我们要改成什么

- Employee bootstrap 只注入:`tool_ids_base`(preset 基础) + `resolve_skill` meta tool + 已挂载 skill 的 **descriptor**(id / name / description,每条 ≤ 50 字)
- 模型判断需要时调 `resolve_skill("sk_research")` → 动态把该 skill 的 `tool_ids + prompt_fragment` 注入**当前对话的 tools[] + 后续 turn 的 system prompt**(不落库,会话级)
- 新 preset `plan` / `plan_with_subagent` · 通过 `tool_ids + skill_ids` 组合表达能力差异(**不是字段**)

---

## 2 · 红线(违反 PR 直接打回)

| # | 红线 | 出处 |
|---|------|------|
| R1 | **禁止**在 `Employee` / `Conversation` / 任何表加 `mode` / `EmployeeKind` / `runtime_mode` / 同义字段 | CLAUDE.md § 3.2 · I-0022 硬约束 |
| R2 | 运转方式 = preset 是 **UI/契约层**概念 · 落库时**只展开**为 `tool_ids + skill_ids + max_iterations`(已有列) | 本 spec § 4.3 |
| R3 | `core/` 禁 import `sqlalchemy` / `fastapi` / `langgraph` / `langchain` / `openai` / `anthropic` · 由 `lint-imports` 强制 | CLAUDE.md § 3.4 |
| R4 | 所有新 meta tool **必须**声明 `ToolScope` · `WRITE` 以上经 `ConfirmationGate` · Meta-only 或 REST 对偶按 L01 扩展版判 | CLAUDE.md § 3.3 · L01 · `test_learnings.py::TestL01ToolFirstBoundary` |
| R5 | 动 `AgentRunner` / `Tool` / Skills 前**必须** Read `ref-src-claude` 对应 volume · commit message 写"参考 `ref-src-claude/<file>` 的 ..." | reference-sources.md §4(当前 track 硬要求) |

---

## 3 · 核心概念 · Preset ≠ Mode

**Preset** 是 **UI/契约层**的分类标签。在 **Employee 创建/编辑页**,用户选择一个 preset,系统**在创建 Employee 实体时一次性展开**为 `(tool_ids, skill_ids, max_iterations)` 三个已存在的列。**落库后 Employee 实体里没有任何 "preset" / "mode" / "kind" 字段**,preset 仅作为 seed / form default / UI 分类标签使用。

> 这等同于前端表单模板:选"Python Web 项目"模板 → 表单预填一套值 → 提交后这套值作为普通字段存入;数据库里不记录"你选了哪个模板"。

v0 三个 preset:

| preset | 定位 | 典型员工 |
|--------|------|----------|
| `execute` | 标准执行员(取数 / 写文件 / 调 builtin tool · 不做计划 · 不分派子任务) | 数据拉取员、文档撰写员、Stock 助手 |
| `plan` | 纯规划员(先输出完整 plan,等人工 approve,本次不动工) | Lead Agent 在复杂任务前的 "先看 plan" 模式 |
| `plan_with_subagent` | 协调员(出 plan → 派 subagent 执行 → 汇总) | Lead-tier · 跨领域协调 |

---

## 4 · Preset → Employee 字段展开

### 4.1 Preset 定义(YAML 契约)

Preset 定义落地为 **Python 常量模块** `backend/src/allhands/execution/modes/{execute,plan,plan_with_subagent}.py` · 每个 ≤ 30 行 · **不是类继承**(I-0022 验收标准)。本 spec 的 YAML 是等价的声明形式:

```yaml
# 注意:employee.mode 字段永远不存在。preset 是 UI 层抽象。
# 在 Employee 创建请求到达 service 层时一次性展开为 tool_ids + skill_ids + max_iterations。

employee_preset:
  execute:
    description: >
      Standard doer. Fetches, writes, runs builtin tools.
      No planning, no subagents. Picks up skills on demand via resolve_skill.
    tool_ids_base:
      - allhands.builtin.fetch_url
      - allhands.builtin.write_file
      - allhands.meta.resolve_skill       # always-on · 动态 skill 注入入口
    skill_ids_whitelist:                  # UI 层推荐勾选集合;用户可自由增减
      - sk_research
      - sk_write
    max_iterations: 10

  plan:
    description: >
      Planner only. Outputs a structured plan via render_plan and stops.
      Human approves before any doer runs.
    tool_ids_base:
      - allhands.builtin.render_plan
      - allhands.meta.resolve_skill
    skill_ids_whitelist:
      - sk_planner
    max_iterations: 3                     # 规划通常 1-3 次 reasoning 够了

  plan_with_subagent:
    description: >
      Coordinator. Plans first, then dispatches subagents to execute.
      Can also run some builtin tools directly.
    tool_ids_base:
      - allhands.builtin.render_plan
      - allhands.meta.spawn_subagent
      - allhands.meta.resolve_skill
    skill_ids_whitelist:
      - sk_planner
      - sk_executor_spawn
    max_iterations: 15                    # Q7 signoff: 20→15 (UX: 20 过高)
```

### 4.2 展开算法(落库 service 层)

```text
POST /employees { preset: "execute", name, model_ref, custom_tool_ids?, custom_skill_ids? }
  ↓ services/employee_service.py::create_employee()
  ↓
preset_def = MODES[preset]                       # 读 Python 常量模块
employee.tool_ids = dedupe(preset_def.tool_ids_base + (custom_tool_ids or []))
# Q6 signoff: skill_ids_whitelist 仅作 UI seed。UI 填入 preset default 后允许用户任意增删,
# service 层以 UI 最终提交的 custom_skill_ids 为准(不再 ∩ 白名单)。
employee.skill_ids = list(custom_skill_ids) if custom_skill_ids is not None else list(preset_def.skill_ids_whitelist)
employee.max_iterations = custom_max_iterations or preset_def.max_iterations
  ↓
employee.preset NO — 不落列!preset 只留在 API request 里作为便捷 seed。
```

### 4.3 Employee Pydantic 模型不改字段

[`backend/src/allhands/core/employee.py`](../../backend/src/allhands/core/employee.py) 现有字段(`id / name / description / system_prompt / model_ref / tool_ids / skill_ids / max_iterations / is_lead_agent / ...`)**不加任何字段**。preset 在 API DTO 和 service 层可见,在 `core.Employee` 域模型和持久化层不可见。

---

## 5 · Meta Tool 契约

### 5.1 `resolve_skill` — 动态 skill 注入

| 属性 | 值 |
|------|-----|
| `id` | `allhands.meta.resolve_skill` |
| `kind` | `META` |
| `scope` | `READ` |
| `requires_confirmation` | `false` |
| `cost_hint` | `low` |
| L01 对偶 | **Meta-only**(无需 REST · 它是 agent runtime 自省,用户在 UI 上已经在"挂载 skill"这步做了选择) |

**入参**

```json
{
  "type": "object",
  "properties": {
    "skill_id": {
      "type": "string",
      "description": "One of the skill_ids mounted on the current employee. Enum populated at turn 0 from employee.skill_ids[]."
    }
  },
  "required": ["skill_id"]
}
```

**出参**

```json
{
  "type": "object",
  "properties": {
    "tool_ids": { "type": "array", "items": { "type": "string" } },
    "prompt_fragment": { "type": "string" },
    "already_loaded": { "type": "boolean" }
  }
}
```

**行为**

1. `AgentRunner` 校验 `skill_id ∈ employee.skill_ids`(白名单 · 防越权);不在 → 返回错误,**不做任何副作用**
2. `SkillRegistry.get(skill_id)` 取 Skill 域对象
3. **注入当前对话的 in-memory 状态**(不落库):
   - `tool_ids` 加到本 `AgentRunner` 实例的 `active_tool_ids[]`
   - `prompt_fragment` 追加到本对话的 `resolved_fragments[]`
4. 下一轮 turn 在组装 LangGraph `create_react_agent` 时:
   - `tools[]` = 基础 tools + 已 resolve 过的 skill tools
   - `system_prompt` = employee.system_prompt + `\n\n`.join(resolved_fragments)
5. 幂等:同一 `skill_id` 多次调用只注入一次(`already_loaded=true`)· 防模型重复 resolve

**不做**

- 不影响其他会话(per-conversation 局部)
- 不影响 employee 表(不落库 · 符合 R1)
- 不跨 subagent(subagent 独立起 `AgentRunner` 自己的 resolve 栈)

### 5.2 `spawn_subagent` — 起子代理执行隔离任务

| 属性 | 值 |
|------|-----|
| `id` | `allhands.meta.spawn_subagent` |
| `kind` | `META` |
| `scope` | `WRITE`(有 side effect · 占 LLM quota · 写 trace) |
| `requires_confirmation` | `true`(经 ConfirmationGate) |
| `cost_hint` | `high` |
| L01 对偶 | **REST 对偶是 `/dispatch`**(已有 `dispatch_employee` 语义接近)· 本工具是**轻量版** · 允许传 profile 而非必须指定 employee_id |

**入参**

```json
{
  "type": "object",
  "properties": {
    "profile": {
      "type": "string",
      "description": "One of: 'execute' | 'plan' | 'plan_with_subagent' | an existing employee slug.",
    },
    "task": { "type": "string", "description": "Self-contained task description (child agent sees only this)." },
    "return_format": {
      "type": "string",
      "description": "Free-form hint telling child what shape its result should take (markdown / json / short summary)."
    },
    "max_iterations_override": { "type": "integer", "minimum": 1, "maximum": 100 }
  },
  "required": ["profile", "task"]
}
```

**出参**

```json
{
  "type": "object",
  "properties": {
    "result": { "type": "object", "description": "Child agent's final structured output (or string)" },
    "trace_id": { "type": "string" },
    "iterations_used": { "type": "integer" },
    "status": { "type": "string", "enum": ["completed", "max_iterations", "error"] }
  }
}
```

**行为**(参考 `ref-src-claude/V10` `AgentTool` → `runAgent()`)

1. **ConfirmationGate**:parent 调用 `spawn_subagent` → gate 弹框("派子代理 A 做 task X,预计 N 轮")· 用户 approve 后才继续
2. **解析 profile**:
   - 如果是 `'execute' | 'plan' | 'plan_with_subagent'` → 构造一个**临时 Employee**(不落库 · 只在内存中)· 用 preset 默认 tool_ids / skill_ids / max_iterations · system_prompt 取 preset 的默认 system_prompt
   - 如果是 employee slug → 从 EmployeeRepo 取现有员工
3. **独立 `AgentRunner` 实例**(**独立 memory scope** · 子 agent 看不到父的对话历史,除了 task 和 return_format 作为其唯一 user message)
4. **嵌套 trace**:
   - 子 run 启动时 `observability/tracing.py` 创建新 trace,`parent_trace_id = 父 agent 的 trace_id`
   - 父 trace 里记 `child_trace_ids[]` · `/traces` 页展开时能导航
5. **终止**:
   - 子 agent 正常完成 → 返回 `{result, trace_id, iterations_used, status:"completed"}`
   - 到 `max_iterations` 未完成 → `status:"max_iterations"` + 最后一条消息作为 result
   - 抛异常 → `status:"error"` + error message · trace_id 仍回传(好让用户去 Observatory 看)

**嵌套约束**(参考 `ref-src-claude/V10` § 4.5 分流约束)

- v0 限制:**subagent 不能再 spawn subagent**(防 fork 炸;LangGraph 本身也没 in-process `AsyncLocalStorage` 的能力)· 校验:若 parent 本身是 subagent(通过 `spawn_context.is_subagent=true` 传入),调 `spawn_subagent` 直接 error
- 这和 `ref-src-claude/V10` 的 "teammates cannot spawn other teammates" 同形

### 5.3 Confirmation Gate 行为

`spawn_subagent` 走 `PersistentConfirmationGate`(已有):
- `summary = "Spawn <profile> subagent to execute: <task 前 80 字>"`
- `rationale = "Child agent will run up to N iterations in an isolated scope."`
- `diff = None`(无文件 diff · 展示 task 全文和预期 iterations)

前端在弹框里**展示**:profile / task / max_iterations / return_format · 用户 approve 或 reject。

---

## 6 · Render Tool 契约

### 6.1 `render_plan` · PlanCard

| 属性 | 值 |
|------|-----|
| `id` | `allhands.builtin.render_plan` |
| `kind` | `RENDER` |
| `scope` | `READ`(render tool 无 side effect) |
| `requires_confirmation` | `false` |
| 对应前端组件 | `web/components/render/PlanCard.tsx`(新) |

> 已有 `allhands.meta.plan_create` / `plan_view`(driving `PlanTimeline` 组件)用于"agent 自己追踪的工作 memo"。`render_plan` 是**用户参与审批**的新语义 · 两个并存(不合并):`PlanTimeline` = 内部进度看板;`PlanCard` = 待人工 approve 的计划卡。

**Input schema**

```json
{
  "type": "object",
  "properties": {
    "plan_id": { "type": "string" },
    "title": { "type": "string" },
    "steps": {
      "type": "array",
      "minItems": 1,
      "maxItems": 20,
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "title": { "type": "string", "maxLength": 120 },
          "body": { "type": "string", "maxLength": 2000 },
          "status": { "type": "string", "enum": ["pending", "approved", "rejected"], "default": "pending" }
        },
        "required": ["id", "title"]
      }
    }
  },
  "required": ["plan_id", "title", "steps"]
}
```

**Output(Render envelope)**

```json
{
  "component": "PlanCard",
  "props": {
    "plan_id": "plan-2026-04-19-abc",
    "title": "Q2 market research rollout",
    "steps": [
      {"id": "s1", "title": "Crawl competitor pages", "body": "...", "status": "pending"}
    ]
  },
  "interactions": [
    {"kind": "button", "label": "Approve", "action": "invoke_tool",
     "payload": {"tool": "allhands.builtin.render_plan", "args": {"plan_id": "plan-...", "decision": "approve"}}},
    {"kind": "button", "label": "Reject", "action": "invoke_tool",
     "payload": {"tool": "allhands.builtin.render_plan", "args": {"plan_id": "plan-...", "decision": "reject"}}},
    {"kind": "button", "label": "Edit", "action": "send_message",
     "payload": {"text": "Please revise step <n>: ..."}}
  ]
}
```

**Approve 回流**

- 用户点 Approve → 前端 invoke_tool `render_plan` 再次,`args: {plan_id, decision: "approve"}` · 这次返回 `{component: "PlanCard", props: {...status: "approved"...}}`(覆盖 turn 中原卡片)· 同时前端在 composer 注入一条 system message `"<plan plan-... approved>"` 送回 agent → agent 可以继续(若 preset = `plan_with_subagent` 下一步就是 `spawn_subagent`)

### 6.2 Protocol 同步(backend ↔ frontend)

- `backend/src/allhands/api/protocol.py` 新增 `PlanCardStep`, `PlanCardProps`
- `web/lib/protocol.ts` 新增双胞胎 TS 类型
- `web/lib/component-registry.ts` 加 `PlanCard` 注册(CLAUDE.md § 6.5)
- `backend/tests/integration/test_render_protocol.py` 已有 parity check · 本 track Phase 3 补上 PlanCard 的 case

---

## 7 · Skill Additions

### 7.1 `sk_planner`

```yaml
id: sk_planner
name: Planning · Output before Act
description: Always emit a full plan via render_plan before taking action.
tool_ids:
  - allhands.builtin.render_plan
prompt_fragment: |
  You are a planner. BEFORE using any write/side-effecting tool, you MUST:
  1. Think through the task.
  2. Call render_plan with a complete ordered list of steps (each step: id, title, body).
  3. STOP and wait for human approval. Do not take further action until the user
     sends back an approval signal.
  If the plan is rejected, revise based on feedback and re-render.
version: 0.1.0
```

### 7.2 `sk_executor_spawn`

```yaml
id: sk_executor_spawn
name: Coordinator · Break Down & Dispatch
description: Decompose big tasks and dispatch subagents via spawn_subagent.
tool_ids:
  - allhands.meta.spawn_subagent
prompt_fragment: |
  You coordinate work by spawning subordinate agents. For each plan step:
  1. Choose the right profile (execute for single-tool tasks, plan for fuzzy ones).
  2. Call spawn_subagent with a self-contained task description and return_format.
  3. Collect results and summarize for the user.
  Do NOT execute side-effecting work yourself when a subagent would isolate risk.
version: 0.1.0
```

两个 skill 都 bundled(`backend/skills/builtin/` 下 · 和现有 `artifacts` / `render` / `stock_assistant` 同目录结构)。

---

## 8 · AgentRunner 生命周期变更

### 8.1 bootstrap(改前 · 改后)

**改前**(`execution/skills.py::expand_skills_to_tools`):

```python
tools, fragment = expand_skills_to_tools(employee, skill_registry, tool_registry)
# tools = employee.tool_ids + 所有 skill 展开的 tool_ids
# fragment = 所有 skill 的 prompt_fragment concat
```

**改后**(重命名 `execution/skills.py::bootstrap_employee_runtime`):

```python
runtime = bootstrap_employee_runtime(employee, skill_registry, tool_registry)
# runtime.base_tools = employee.tool_ids (preset.tool_ids_base 已展开到这里)
# runtime.skill_descriptors = [{id, name, description<=50字} for sid in employee.skill_ids]
# runtime.resolved_skills = {}  # 运行时填充
# runtime.resolved_fragments = []  # 运行时填充
```

### 8.2 每轮 turn 组装(参考 `ref-src-claude/V02` `query()` 主循环)

```python
# AgentRunner.stream() 每轮入 while(true) 前:
lc_tools = build_structured_tools(
    base_tool_ids = runtime.base_tools,
    resolved_tool_ids = list(runtime.resolved_skills.keys_to_tools()),  # flat
    tool_registry = self._tool_registry,
    gate = self._gate,
)
system_prompt = employee.system_prompt + "\n\n" + render_skill_descriptors(runtime.skill_descriptors) \
                + "\n\n" + "\n\n".join(runtime.resolved_fragments)

agent = create_react_agent(model, lc_tools)  # 每轮可重建(廉价)
```

**关键**:LangGraph `create_react_agent` 每轮重建 · 不是"启动一次固定住"。这对应 `ref-src-claude/V02` § 2.1 的 `while(true)` + 每轮 `normalizeMessagesForAPI(messages)` 模式。

### 8.3 `resolve_skill` tool 执行后如何影响下一轮

```
模型发 tool_use: resolve_skill(skill_id="sk_research")
  ↓
runner.executor:
  skill = skill_registry.get("sk_research")
  if "sk_research" in runtime.resolved_skills: return {already_loaded: true}
  runtime.resolved_skills["sk_research"] = skill.tool_ids
  runtime.resolved_fragments.append(skill.prompt_fragment)
  return {tool_ids: skill.tool_ids, prompt_fragment: skill.prompt_fragment, already_loaded: false}
  ↓
tool_result 回灌 transcript
  ↓
while(true) 下一轮 · 重建 lc_tools 和 system_prompt(已带新 fragments)
  ↓
模型看到 fetch_url 可用 · 调用它
```

### 8.4 Skill Descriptor 静态清单格式(塞 system prompt)

```text
Available skills (call resolve_skill("<id>") to activate):
- sk_research: Research the web using fetch_url and summarize.
- sk_write: Write structured documents to files.
- sk_planner: Always emit a plan before acting.
```

**每条 ≤ 50 字** · 10 个 skill → ~500 字 · **token 从 ~3000 降到 ~600**(验收标准 I-0022 第二条)。

---

## 9 · Observability / Trace 契约

### 9.1 `resolve_skill`

- 不开子 span · 作为 parent trace 的一个 tool-call event 记录
- trace event 字段:`skill_id`, `tool_ids_injected`, `fragment_length`, `already_loaded`

### 9.2 `spawn_subagent`

- **独立 trace**:`parent_trace_id = <caller trace_id>` · `is_subagent = true`
- 父 trace 的 `metadata.child_trace_ids[]` 追加子 trace_id
- `/traces` 页的 TraceDetail 组件 tree-expand 子 trace(Track K 负责 UI · 本 track 负责后端字段)
- Langfuse span:父 span 下 nest 子 span(Langfuse 原生支持 parent_span_id)

---

## 10 · L01 Tool First 对偶表

| 新 tool | REST 对偶 | 备注 |
|---------|-----------|------|
| `allhands.meta.resolve_skill` | **meta-only** | 运行时自省 · UI 上用户"挂载 skill" 已经是 CRUD 等价动作(走现有 `/skills` + `/employees`) |
| `allhands.meta.spawn_subagent` | `/dispatch`(已有 · `dispatch_employee`) | 本 tool 是轻量版 · 允许临时 preset profile · REST 对偶也要扩支持 profile 传参 · **Phase 2 顺带扩** |
| `allhands.builtin.render_plan` | `/plans`(现有) + `/plans/<id>/approve`(Phase 3 新增) | UI 可以独立开 /plans 页看历史 plan · 同时支持 Lead Agent 通过 chat 发 plan |

`test_learnings.py::TestL01ToolFirstBoundary` 在 Phase 2/3 commit 里补充断言。

---

## 11 · 验收标准映射(I-0022)

| I-0022 验收条目 | 本 spec 对应 |
|-----------------|---------------|
| commit 1 · docs/specs/agent-runtime-contract.md 交付 · 停等签字 | 本文件 |
| Phase 1 · `resolve_skill` 落地 · mid-turn tools[] 扩展 · 回归 `test_resolve_skill_extends_tools_mid_turn` | § 5.1 + § 8.3 |
| Phase 1 · 10 skill 员工 system prompt token 从 ~3000 降到 ~600 · trace 里放数字 | § 8.4 |
| Phase 2 · `spawn_subagent` + `sk_executor_spawn` + 嵌套 trace_id | § 5.2 + § 7.2 + § 9.2 |
| Phase 3 · `sk_planner` + `render_plan` + `PlanCard` + e2e planner-flow | § 6.1 + § 7.1 |
| 3 preset 在 `execution/modes/{execute,plan,plan_with_subagent}.py` 配置字典 · ≤ 30 行 | § 4.1 |
| `test_learnings.py::TestL01ToolFirstBoundary` 通过 | § 10 |
| `./scripts/check.sh` 全绿 · 包含 lint-imports | 每 commit 验证 |
| 3 seed 员工 · 1 条 plan+subagent 历史对话(含嵌套 trace) | Phase 4(与 Track N 协作) |

---

## 12 · 已知问题 / 开放问题

### 12.1 已关闭(本 spec 决定)

- **Q1**:preset 是否落字段? → **否**(R1 红线)· UI 层概念,service 层一次性展开
- **Q2**:render_plan vs 现有 plan_create/plan_view? → **并存**:plan_create = agent 内部进度 memo,无需 approve;render_plan = 待 approve 的用户契约
- **Q3**:subagent 能再 spawn subagent 吗? → **v0 否**(§ 5.2 嵌套约束)
- **Q4**:resolve_skill 幂等吗? → **是**(§ 5.1 行为 5)
- **Q5**:resolve_skill 跨 subagent 吗? → **否**(per-runner 局部)

### 12.2 待 Track L(I-0021)反馈后决定

- **Q6**:员工设计页是否 UI 上选 preset 后自动填 `tool_ids` + `skill_ids` 但允许用户手动增删? → 建议 **是**(符合 "preset = form template" 的定位)· 等 L 确认交互
- **Q7**:`plan_with_subagent` preset 的默认 `max_iterations=20` 是否过高? → 等 L 评估 UX(滑杆默认值)
- **Q8**:PlanCard 的 Approve 按钮点击后,是否需要用户在 composer 补一句"继续" 才能让 agent 继续? → 建议 **否**(approve 自带 "继续" 语义 · 自动 send 系统 message)· 等 L 确认

### 12.3 已签字(本 spec 初稿决定)

- ~~三个 preset 名称(`execute` / `plan` / `plan_with_subagent`)是否对用户可见?~~ → Q9 **对用户可见** · 友好中文名由 preset 模块 `LABEL_ZH` 暴露(UI 展示)· 底层 id 保英文(API / DB)
- ~~v0 是否要支持第四个 preset `lead`?~~ → Q10 **否** · `is_lead_agent` 是正交标志

### 12.4 Q6-Q10 签字 delta(2026-04-19)

签字文件:`/Volumes/Storage/code/allhands/docs/specs/SIGNOFF-agent-runtime-contract.md`(main `18cfacf`)。

| Q | 签字答复 | 本 spec 已应用 |
|---|----------|----------------|
| Q6 | UI preset 填入 tool_ids + skill_ids 后允许用户增删 | § 4.2 展开算法(skill_ids 改为 UI 直传,不再与白名单取交集) |
| Q7 | `plan_with_subagent.max_iterations` 20 过高 → **15** | § 4.1 YAML |
| Q8 | PlanCard Approve 后无需用户补"继续" | 无需改契约(§ 6.1 Approve 回流已描述自动 send system message) |
| Q9 | Preset 名对用户可见 · 友好中文名 | § 4.1 YAML 注:UI 层由 preset 模块 `LABEL_ZH` 导出 |
| Q10 | 不加 `lead` preset | § 12.3 已标注 `is_lead_agent` 正交 |

---

## 13 · Ref-src-claude 引用(commit message 用)

| 本 spec 决策 | 参考 ref-src-claude 文件 | 参考要点 |
|--------------|---------------------------|----------|
| resolve_skill 动态注入替代 pre-load | `V05-skills-system.md` § 2.1 `getSkillDirCommands` memoize 发现 / § 2.3 `createSkillCommand` · `getPromptForCommand` 按需展开 | Skills **声明但不 pre-load** |
| 每轮 turn 重建 lc_tools | `V02-execution-kernel.md` § 2.1 `query()` 主循环 `while(true)` + `normalizeMessagesForAPI` 每轮执行 | AsyncGenerator 主循环在轮边界上调整 context |
| spawn_subagent 独立 memory scope | `V10-multi-agent.md` § 2.2 in-process spawn · AsyncLocalStorage 隔离 · § 4.5 分流约束 | teammate/subagent 不能无限嵌套 |
| 嵌套 trace_id | `V10-multi-agent.md` § 2.4 权限桥 · `workerBadge` / parent-child 标识 | 父 trace 可导航到子 trace |
| Tool scope + ConfirmationGate | `V04-tool-call-mechanism.md` § 2.1 Tool 抽象 `isDestructive / checkPermissions` · § 2.5 runToolUse 六阶段管线 | scope 声明强制,默认 fail-closed |
| render_plan vs plan_create 并存 | `V04-tool-call-mechanism.md` § 2.2.2 内建工具同名冲突时内建优先 · 工具以 `name` 寻址 | 同类能力可并存,靠名字区分 |

---

## 14 · Phase 0 交付物清单(commit 1)

- [x] 本文件 `docs/specs/agent-runtime-contract.md`
- [x] `backend/tests/integration/test_resolve_skill_mid_turn.py`(skip placeholder)
- [x] `backend/tests/integration/test_spawn_subagent_isolated_memory.py`(skip placeholder)
- [x] `backend/tests/unit/test_skill_registry_lazy.py`(skip placeholder)
- [x] `TRACK-M-PROGRESS.md` · "M Phase 0 done · 等 Track L + 用户签字"

**commit 1 后停下来**。等用户发"可以继续"后进入 Phase 1(`resolve_skill` + `bootstrap_employee_runtime`)。
