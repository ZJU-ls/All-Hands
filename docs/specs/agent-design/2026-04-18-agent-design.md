# Agent(员工)设计 Spec · 渐进式披露 + 统一 ReactAgent

**日期** 2026-04-18
**状态** Draft — 待用户 review 后转 implementation plan
**产出方** Claude(讨论/设计端 · Opus 4.7)
**消费方** 另一个 Claude(执行端,夜间 autopilot)
**位置约定** 本 spec 在 `docs/specs/agent-design/`;不入侵 `product/`(产品契约)与 `backend/` / `web/`(执行端正在改的目录)

---

## 0 · 读本 spec 之前必读

按顺序:

1. [`CLAUDE.md`](../../../CLAUDE.md) § 3.1(Tool First 扩展版)· § 3.2(统一 React Agent · **禁 `mode` 字段**)· § 3.3(Confirmation Gate)· § 3.4(分层 import)
2. [`product/04-architecture.md`](../../../product/04-architecture.md) § L4.3 Employee · § L5.2 AgentRunner · § L5.6 expand_skills_to_tools · § L5.7 内置 Meta Tools
3. [`docs/claude/learnings.md`](../../claude/learnings.md) L01 扩展版(Agent 全知全能 = 平台能力都要有 Meta Tool)
4. [`docs/claude/reference-sources.md`](../../claude/reference-sources.md) · **参考源码索引**。写 AgentRunner / Tool / Dispatch / prompt 之前,按 § 13.1 的对标表去 `ref-src-claude` 读对应模块 —— **不是可选,是强制**

> **最重要的一条**:数据模型里 **不能** 加 `mode` 字段。所谓"不同模式"的员工,**差异只存在于 `tool_ids[]` 的组合**。任何出现 `Employee.mode` / `EmployeeKind` / 类似字段的 PR 立即打回。

---

## 1 · 问题陈述

v0 MVP 已经有 `Employee` / `AgentRunner` / `dispatch_employee` 这些骨头(见 [`product/04-architecture.md`](../../../product/04-architecture.md) § L4.3 / § L5.2 / § L5.7)。但有两个问题尚未闭合:

**问题 A · LeadAgent 如何认识所有员工。**
单纯把所有员工的 `system_prompt` 全拼进 Lead 的上下文 → token 爆炸 + 员工多了就糊。
**需要一个"分层加载"机制**,类似 skill 系统的渐进式披露。

**问题 B · 员工能力差异该怎么表达。**
用户明确表达过 3 类员工:
- 简单 React 循环(做一件事)
- 支持 Plan(先列计划再执行)
- 支持调度子代理(协调员 / Lead 级)

CLAUDE.md § 3.2 又禁止引入 `mode` 字段。
**需要一个"只通过 tool 组合表达能力差异"的干净路径**。

---

## 2 · 核心原则 · 渐进式披露

借用 skill 系统的三层装载思路,搬到 Employee:

| 层级 | Skill 系统 | Employee 系统 | Token 规模 |
|---|---|---|---|
| **L1 · 元数据**(常驻 Lead 上下文) | 所有已装 skill 的 `name + description` | 所有 employee 的 `name + description` | 每条 ≤ 100 token |
| **L2 · 按需全文**(Lead 拉一次) | `Skill(name)` 载入 SKILL.md 全文 | `get_employee_detail(id)` 返回 system_prompt 完整文本 + tool_ids + skill_ids + max_iterations + is_lead_agent(详见下) | 每条 500–2000 token |
| **L3 · 执行态**(子作用域) | Skill 内部再加载 sub-doc | `dispatch_employee(id, task)` 起独立 `AgentRunner`,**不继承**父 conversation 消息历史 | N/A(独立 run) |

**一条规则**:Lead Agent 的 system prompt **永远不包含**任何具体员工的 system_prompt。L1 看名字 + 描述 → 判断派谁 → L2 按需拉细节 → L3 真派活。

**`get_employee_detail` 返回契约**(本 spec 明确,既有实现若不一致需对齐):

```python
class EmployeeDetail(BaseModel):
    id: str
    name: str
    description: str
    system_prompt: str           # 完整 prompt(对 Lead 暴露,好让 Lead 判断"这员工该不该派")
    tool_ids: list[str]
    skill_ids: list[str]
    max_iterations: int
    is_lead_agent: bool
    # 故意不回:model_ref / created_by / metadata(Lead 不需要)
```

---

## 3 · 数据模型 · 保持不动

[`product/04-architecture.md`](../../../product/04-architecture.md) § L4.3 已经定义的 `Employee` 模型,**本 spec 不改任何字段**:

```python
class Employee(BaseModel):
    id: str
    name: str                       # 全局唯一
    description: str                # ← L1 元数据;Lead Agent 常驻上下文就靠这条
    system_prompt: str              # ← L2 按需;get_employee_detail 返回摘要
    model_ref: str
    tool_ids: list[str] = []        # ← 本 spec 的唯一抓手:三种 Profile = 三种组合
    skill_ids: list[str] = []
    max_iterations: int = 10
    is_lead_agent: bool = False     # ← 全局唯一;约束谁能挂 dispatch_employee
    created_by: str
    created_at: datetime
    metadata: dict = {}
```

**不变式(现有,强化一条)**

- `tool_ids ∪ skill_ids ≠ ∅`(必须至少挂一个)
- `1 ≤ max_iterations ≤ 100`
- `is_lead_agent=True` 全局唯一
- **(新强化)** `dispatch_employee` 这个 tool 只允许出现在 `is_lead_agent=True` 或 `tool_ids` 中显式声明了 `allhands.meta.dispatch_employee` 的员工上。详见 § 7。

---

## 4 · 三种 Profile · 只是三种 tool 组合

**Profile 不是 Employee 的字段**,是一个**展示/讨论用的分类标签**。UI 可以根据 `tool_ids` 派生一个 `badges[]`(前端纯计算):

```ts
// web/lib/employee-profile.ts (新文件,前端派生)
export function deriveProfile(employee: Employee): Badge[] {
  const badges: Badge[] = ['react'] // 所有员工都是 ReactAgent,一定在
  if (employee.tool_ids.some(t => t.startsWith('allhands.meta.plan_'))) badges.push('planner')
  if (employee.tool_ids.includes('allhands.meta.dispatch_employee'))     badges.push('coordinator')
  return badges
}
```

### 4.1 Profile R · React 工蚁

- **tool_ids**:业务工具(任意)+ render 工具(任意)
- **没有** `plan_*`、**没有** `dispatch_employee`
- **典型岗位**:researcher、fetcher、reviewer、writer
- **控制流**:think → tool → think → tool → ... → final answer(标准 LangGraph `create_react_agent`)

### 4.2 Profile P · 会做 Plan 的员工

- **tool_ids**:Profile R 全集 **+** `allhands.meta.plan_create` / `plan_update_step` / `plan_complete_step` / `plan_view`
- **典型岗位**:coder、analyst
- **控制流**:plan_create → 执行 step 1 → plan_update_step → 执行 step 2 → ... → plan_complete
- **plan 存在哪**:新建 DB 表 `agent_plans`(conversation 维度),**不是** Employee 字段。见 § 5.1。

### 4.3 Profile C · 协调员 / Sub-lead

- **tool_ids**:Profile P 全集 **+** `allhands.meta.list_employees` / `get_employee_detail` / `dispatch_employee`
- **典型岗位**:**Lead Agent(唯一全局 coordinator)** + 可选的 sub-lead(如"产品经理员工"调 designer + writer)
- **控制流**:list_employees → get_employee_detail (可选) → dispatch_employee → 收子 run 结果 → 继续

---

## 5 · 需要新增的 Meta Tool(共 4 个,Plan 族)

既有的 Meta Tool 存量(见 [`product/04-architecture.md`](../../../product/04-architecture.md) § L5.7)已经有 `list_employees` / `get_employee_detail` / `dispatch_employee` / create / update / delete。本 spec 只新增 Plan 族:

### 5.1 DB · 新建表 `agent_plans`

位置:`backend/alembic/versions/00NN_add_agent_plans.py`(autopilot 自己选编号)

```sql
CREATE TABLE agent_plans (
  id            TEXT PRIMARY KEY,              -- uuid4
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  run_id        TEXT,                          -- 哪一次 run 创建的(可选关联)
  owner_employee_id TEXT NOT NULL,
  title         TEXT NOT NULL,
  steps         JSONB NOT NULL,                -- [{index, title, status, note}, ...]
                                               -- status ∈ {pending, running, done, skipped, failed}
  created_at    TIMESTAMP NOT NULL,
  updated_at    TIMESTAMP NOT NULL
);
CREATE INDEX idx_agent_plans_conversation ON agent_plans(conversation_id);
```

### 5.2 Tool 定义(放 `backend/src/allhands/execution/tools/meta/plan_tools.py`)

| Tool ID | Scope | Confirmation | 功能 |
|---|---|---|---|
| `allhands.meta.plan_create` | WRITE | **no**(低风险,只是写规划) | 新建 plan。参数:`title`、`steps: list[str]`。返回:`plan_id` |
| `allhands.meta.plan_update_step` | WRITE | no | 改单步。参数:`plan_id`、`step_index`、`status`、`note?` |
| `allhands.meta.plan_complete_step` | WRITE | no | 把某步标 done(快捷) |
| `allhands.meta.plan_view` | READ | no | 看当前 plan(returns Render payload `PlanTimeline`)|

**为什么 WRITE 不要 confirmation**:plan 本身是 agent 的"笔记",不触达外部系统。真正的副作用发生在 step 里调的业务 tool。保持 UX 流畅 = 别每改一步都弹确认。

### 5.3 Render Tool · `PlanTimeline`

前端组件 `web/components/render/PlanTimeline.tsx`,展示横向 timeline:已完成 / 进行中 / 待做。`plan_view` 返回的 render payload 驱动它。

---

## 6 · Dispatch 协议 · 嵌套执行规则

`dispatch_employee` 已存在于 [`backend/src/allhands/execution/tools/meta/employee_tools.py`](../../../backend/src/allhands/execution/tools/meta/employee_tools.py)。本 spec 强化以下契约(如果 autopilot 尚未实现到这颗粒度,按此补):

### 6.1 参数契约

```python
async def dispatch_employee(
    employee_id: str,
    task: str,                         # 清晰的任务描述(必须)
    context_refs: list[str] = [],      # 可选:前序 run_id 或 message_id,用于引用先前产出
    timeout_seconds: int = 300,        # 默认 5 分钟
) -> DispatchResult:
    """DispatchResult { run_id, status, summary, output_refs }"""
```

### 6.2 执行规则

1. **新 thread_id**。子 run 起自己独立的 LangGraph thread,不复用父 conversation 的 messages。
2. **父子串联**。子 run 所有 Message 的 `parent_run_id` 写父 run 的 id(`Message` 模型已有此字段,见 § L4.4)。
3. **上下文传递**。子 employee 的 system_prompt = 自己的 system_prompt + "当前父任务:{task}"+ (可选) "引用先前产出 {context_refs 解析后的文本}"。**不**把父 conversation 全部塞进去。
4. **Confirmation Gate 穿透**。子 run 里调 WRITE 工具 → 照常走 Gate → 弹给用户。不允许"Lead 一次批准"。
5. **嵌套深度上限**。默认 `MAX_DISPATCH_DEPTH=3`(可 env 覆盖)。depth=0 是 Lead;depth>=3 时 `dispatch_employee` 直接返回 `ERR_MAX_DEPTH`。
6. **循环预算独立**。子 run 自己的 `max_iterations` 独立计数。但父 run 调 dispatch 本身 **算一次 iteration**。
7. **Trace**。Langfuse span 以嵌套 span 呈现,UI 里展开一个 disclosure 看子 run。

### 6.3 错误场景

| 条件 | 行为 |
|---|---|
| `employee_id` 不存在 | 返回 `ERR_EMPLOYEE_NOT_FOUND`(Agent 可自我修复:重查 list_employees) |
| 深度超限 | `ERR_MAX_DEPTH` |
| 超时 | 子 run 中断,返回 `ERR_TIMEOUT` 及中断时的部分输出 |
| 子 run 自己失败(tool 报错 / max_iterations) | 返回 `ERR_SUB_RUN_FAILED` + 失败原因 |

---

## 7 · 约束:谁能挂 `dispatch_employee`

**规则**(写进 `backend/src/allhands/services/employee_service.py` 的 create/update 校验):

- 若 `is_lead_agent=True` → 自动注入 `dispatch_employee` + `list_employees` + `get_employee_detail` 到 `tool_ids`(保证全集)
- 若 `is_lead_agent=False`,但显式 `tool_ids` 里有 `allhands.meta.dispatch_employee` → 允许,记一条 WARN log(这是 sub-lead 用法),同时要求 `list_employees` + `get_employee_detail` 也必须在 tool_ids(不然员工不知道能派谁)
- 其他情况挂了 `dispatch_employee` → **拒绝**,返回 `InvariantViolation`

---

## 8 · Lead Agent 的 System Prompt 模板(示意,不强制)

```
你是 allhands 平台的 Lead Agent,用户通过你操作平台。
你不直接执行专业工作,而是:
1. 先用 list_employees() 查看可用员工名单(只会返回 name + description)
2. 根据任务选合适的员工(必要时 get_employee_detail 看细节)
3. 用 dispatch_employee 把任务交给他们,收回结果后汇总

你还可以执行平台管理:
- 创建/编辑员工(create_employee / update_employee / delete_employee)
- 管理技能和 MCP(list_skills / install_mcp_server 等)
- 管理模型和 provider(add_provider / create_model 等)

任何写操作都会触发用户确认 gate,不要担心"一按就炸"。
```

**这个模板放哪**:`backend/src/allhands/execution/prompts/lead_agent.md`(新文件)。Bootstrap 候选版本通过既有机制管理(参考 L5.7 的 `propose_lead_agent_version`)。

---

## 9 · 和正在并行编码的 Claude 的协同

**执行端 Claude 已经在改的文件**(2026-04-18 git status):

```
backend/src/allhands/execution/runner.py
backend/src/allhands/services/employee_service.py
backend/src/allhands/services/chat_service.py
backend/src/allhands/execution/gate.py
backend/src/allhands/core/tool.py
backend/src/allhands/api/routers/employees.py (新)
web/app/employees/                           (新)
```

**本 spec 的新增/修改落点**(与上面**无重叠或有序避让**):

| 本 spec 要改的 | 和执行端的关系 |
|---|---|
| `backend/alembic/versions/00NN_add_agent_plans.py`(新) | **无冲突** |
| `backend/src/allhands/execution/tools/meta/plan_tools.py`(新) | **无冲突** |
| `backend/src/allhands/persistence/repos/plan_repo.py`(新) | **无冲突** |
| `backend/src/allhands/core/plan.py`(新 L4 domain) | **无冲突** |
| `web/components/render/PlanTimeline.tsx`(新) | **无冲突** |
| `web/lib/component-registry.ts`(加一行) | 轻微;最后合并 |
| `web/lib/employee-profile.ts`(新) | **无冲突** |
| `backend/src/allhands/services/employee_service.py`(加 dispatch tool 校验) | **有重叠** → autopilot 需 pull 执行端的最新版后 patch |
| `backend/src/allhands/execution/tools/meta/employee_tools.py`(强化 dispatch_employee 契约) | **有重叠** → 同上 |
| `backend/src/allhands/execution/prompts/lead_agent.md`(新) | **无冲突** |

**协议**:
- 本 spec 交给夜间 autopilot 前,先在本 spec 里记录**当时**执行端最后一次 commit(预计在 spec 审核时补一行)
- autopilot 开工前先 `git status`,如发现执行端又动了两处重叠文件 → **先 pull/读清楚,再 patch,不要覆盖**

---

## 10 · v0 scope

### In-scope(本 spec 的交付范围)

- [x] Profile 分类只在前端派生,无 DB 字段
- [x] 新增 4 个 Plan 族 Meta Tool + 配套 `agent_plans` 表
- [x] `PlanTimeline` render 组件 + 注册到 component-registry
- [x] 强化 `dispatch_employee` 契约(6.2 所列 7 条)
- [x] `is_lead_agent` 与 `dispatch_employee` 的挂载校验(§ 7)
- [x] `lead_agent.md` system prompt 模板文件
- [x] 回归测试(见 § 11)
- [x] 更新 `product/04-architecture.md` § L5.7 把 plan_* 加进 Meta Tools 表
- [x] 更新 `CLAUDE.md` § 3.1 的 Meta Tool 豁免说明(如需)
- [x] 不写任何独立的 Employee 编辑 UI(CLAUDE.md § 6.7 禁:员工管理必须走 Lead Agent + render tool)

### Out-of-scope(v0 不做,v1 再说)

- ~~Employee 版本管理 / rollback~~(等 PR 需求)
- ~~Sub-lead 的权限模型(哪些员工能被哪些 sub-lead 调)~~(v0 只要 Lead 能调所有,sub-lead 也能,但用一条 WARN log 提示)
- ~~plan 的并行执行(多 step 同时跑)~~(v0 只串行)
- ~~dispatch 的 streaming(子 run 实时推 token 回父)~~(v0 dispatch 是"发起 + 收结果",不是流式)
- ~~Employee 专属 MCP 的隔离(员工 A 挂的 MCP 不让员工 B 用)~~(v0 所有 MCP 全局共享,按 Employee.tool_ids 做过滤)

---

## 11 · 回归测试清单

autopilot 每写完一块要让对应测试绿:

| 测试文件 | 用途 |
|---|---|
| `backend/tests/unit/tools/test_plan_tools.py` | plan_create/update/complete/view 的单元 |
| `backend/tests/unit/test_learnings.py::TestL01ToolFirstBoundary` | **反转规则**:有 REST 写操作的 Agent-managed 资源必须有同名 Meta Tool(已存在;确保 plan_* 不漏) |
| `backend/tests/unit/test_dispatch.py`(新) | § 6.2 的 7 条契约逐条:new thread_id / parent_run_id / context 不继承 / gate 穿透 / 深度上限 / 预算独立 / trace 嵌套 |
| `backend/tests/unit/test_employee_invariants.py`(新或扩) | § 7:dispatch_employee 挂载校验的 3 条规则 |
| `backend/tests/integration/test_lead_agent_flow.py`(新) | 端到端:user → lead(list_employees + dispatch) → sub run(完成任务) → lead 汇总 → 用户看到最终回答 |
| `web/tests/unit/employee-profile.test.ts` | `deriveProfile()` 派生正确 |
| `web/tests/e2e/plan-timeline.spec.ts` | `PlanTimeline` 组件在 chat UI 中正确渲染 + 样式吻合 design-system |

---

## 12 · 开放问题(提交 review 前要回答)

1. **Plan 的粒度谁定**:Agent 自主定 step,还是需要 system prompt 给出固定的"最小 step 数 / 最大 step 数"?
   - 默认建议:**Agent 自主**。但 `plan_create` 参数加 `min_steps=1, max_steps=20` 硬约束,防乱拆。
2. **dispatch_employee 的 timeout 默认值**:§ 6.1 写了 300s。偏长还是偏短?
   - 默认建议:保留 300s,env 可覆盖 `DISPATCH_DEFAULT_TIMEOUT`。
3. **嵌套深度 3 够用吗**:Lead → sub-lead → worker。够不够?
   - 默认建议:3 够用(更深通常是设计不清)。env 可覆盖。
4. **Profile badge 叫法**:"React 工蚁 / Planner / Coordinator" 这组中文标签,用户侧 UI 展示用什么?
   - 默认建议:不展示中文 Profile 名,展示派生出的**能力 badge**:`可执行` / `会做计划` / `能带团队`。
5. **Lead Agent 的 system prompt 需要 Bootstrap 候选版本管理吗**:参照 L5.7 propose_lead_agent_version。
   - 默认建议:v0 就一个硬编码文件 `lead_agent.md`,不上 Bootstrap 流程。等 v1 再上。

---

## 13 · 交付验收(DoD)

autopilot 把本 spec 落完后,以下所有条件必须满足:

- [ ] `./scripts/check.sh` 全绿(lint / type / test)
- [ ] § 11 所列测试文件都存在且绿
- [ ] `product/04-architecture.md` § L5.7 的 Meta Tools 表已加 4 条 plan_*
- [ ] 新创建的 employee(非 Lead)挂 `dispatch_employee` 的尝试 → 被 service 层拒绝(手测)
- [ ] Lead Agent 在 `/chat` 会话里能走通完整流程:list_employees → dispatch → 收结果 → 汇总回答(手测,出一张截图放这里)
- [ ] 本 spec § 12 的 5 个开放问题,要么按"默认建议"落地,要么在 spec 里用 **"Decision:"** 前缀注明最终决定 + 决策时间

---

## 13.1 · 参考源码(动手前必读)

> 写 AgentRunner / Tool / Dispatch / prompt 相关代码前,**先去 ref-src-claude 里对照看一眼 Claude Code 怎么做**。规则见 [`docs/claude/reference-sources.md`](../../claude/reference-sources.md)。

| 本 spec 涉及 | 对标 ref-src-claude 入口 | 抽什么 · 适配方向 |
|---|---|---|
| **§ 2 渐进式披露 · list/detail/dispatch 三层** | `ref-src-claude/volumes/V05-skills-system.md` + `V02-query-engine.md` | Claude Code skill 的"metadata 常驻 → SKILL.md 按需加载 → 执行期继续深入"三层披露是本 spec 的设计原型。**直接把这套"级联披露"语义照搬到 Employee**,只是把 skill 换成 employee |
| **§ 4 三种 Profile = tool 组合** | `ref-src-claude/src/Tool.ts`(V04) | Tool 声明 / scope / schema 的 pattern。我们的 `plan_*` / `dispatch_employee` 就按这个套路出 |
| **§ 5 Plan 族 Meta Tool** | Claude Code 的 **TodoWrite** 工具(V04 / V0N · TodoWrite 一节) | TodoWrite 就是"agent 自己列计划、自己勾选、用户可见" —— 和我们的 plan_* 语义 1:1 对应。**重点抽:TodoWrite 的 input schema、状态枚举、前端如何渲染"在做的 step"** |
| **§ 6 Dispatch 嵌套执行 · parent_run_id / 新 thread_id** | Claude Code 的 **Task 工具**(subagent dispatch,V04 · Task 子章) + `query.ts` 的 AsyncGenerator 主循环(V02) | Task 工具就是 Lead 派子 agent 的 Claude Code 版本。**重点抽:context 如何隔离(不继承父对话)· 子 run 的事件如何冒泡回父 · 嵌套深度的上限** |
| **§ 6.2.4 Confirmation Gate 穿透子 run** | `ref-src-claude/src/permissions/*`(V04 末段) | Permission mode / 权限请求 event 的设计。**我们的 ConfirmationGate 要确保子 run 调 WRITE 工具时,gate event 能正确冒泡到当前活跃 conversation 的 SSE 流** |
| **§ 8 Lead Agent system prompt** | Claude Code 的 system prompt 结构(V02 或相关 prompt 文件) | Claude Code 的主 prompt 模块化写法(能力声明 / 工具使用约束 / 输出风格)。照这个结构组织 `lead_agent.md`,别乱写 |

**查阅工作流**:autopilot 开始实现每个模块前,先 `Read` 对应入口 → 写 1 条笔记("参考 X 的 Y 模式 → 适配到我们的 Z")→ 笔记进 commit message。

---

## 13.5 · 扩展 spec(2026-04-18 追加)

本 spec 聚焦 Employee 本体 + Profile + Plan + Dispatch。下列六份独立 spec 覆盖用户驱动 AI Team 场景的其余核心能力,**并列交付**:

### 13.5.1 第一批 · 员工对话 + 可视化 + 制品

| Spec | 主题 | 与本 spec 的关系 |
|---|---|---|
| [2026-04-18-employee-chat.md](./2026-04-18-employee-chat.md) | 员工独立对话 + 渲染管道复用 | 提供"与任一员工对话"入口 + 统一 MessageList + NestedRunBlock(展示本 spec 的 dispatch 产物) |
| [2026-04-18-viz-skill.md](./2026-04-18-viz-skill.md) | 可视化渲染 skill `allhands.render` | 10 个 render tool 打包。本 spec 的 `PlanTimeline` 归入此 skill 的 `Viz.Timeline` |
| [2026-04-18-artifacts-skill.md](./2026-04-18-artifacts-skill.md) | 制品区 skill `allhands.artifacts` | 多模态持久化产出。依赖 viz-skill 的组件做预览 |

### 13.5.2 第二批 · 驾驶舱 + 自运转 + 观测

| Spec | 主题 | 与本 spec 的关系 |
|---|---|---|
| [2026-04-18-cockpit.md](./2026-04-18-cockpit.md) | 驾驶舱首页 `/` + workspace-level SSE | 提供全知全控首页。本 spec 的 run / dispatch 作为核心展示对象;Lead 聊天降级为快速操作 |
| [2026-04-18-triggers.md](./2026-04-18-triggers.md) | 触发器 · Timer + Event + 自运转 | 通过 `dispatch_employee` action 驱动本 spec 定义的员工 · 带 `trigger_id` 标记的 run |
| [2026-04-18-observatory.md](./2026-04-18-observatory.md) | Langfuse 自部署 + 自动绑定 + `/observatory` | 观测本 spec 所有员工的 agent run;bootstrap 自动跑,不需要手工配 |

### 13.5.3 第三批 · 任务通道 + 自审循环 + 核心工具集

| Spec | 主题 | 与本 spec 的关系 |
|---|---|---|
| [2026-04-18-tasks.md](./2026-04-18-tasks.md) | 任务 Task 一等对象 · fire-and-forget 异步通道 | 聊天 / 任务正交;triggers 的 dispatch_employee action 统一走 tasks.create;Lead 需长跑时建 task 而不是 chat 内嵌套 dispatch |
| [2026-04-18-self-review.md](./2026-04-18-self-review.md) | 强制 3 轮反思(好看 / 好用 / 爱不释手)| 交付完 8 份 spec 后跑一次;沉淀到 working-protocol 阶段 4.5 |
| [2026-04-18-toolset.md](./2026-04-18-toolset.md) | 核心工具集 Plan/SubAgent/Sandbox/Web/FS + AG-UI 渲染契约 | 扩展本 spec § 5 Plan · § 6 Dispatch · 把"员工能力边界 = tool"做成系统级,覆盖 render 对齐 |

### 13.5.4 第四批 · 工具链自审 + 视觉升级 + 终局验收

| Spec | 主题 | 与本 spec 的关系 |
|---|---|---|
| [2026-04-18-harness-review.md](./2026-04-18-harness-review.md) | 执行端 audit `docs/claude/*.md` + `harness-playbook.md` + 冷却后回看产品 | self-review 改产品 · harness-review 改"做产品的工具链"。顺序:self-review 完 → harness-review |
| [2026-04-18-visual-upgrade.md](./2026-04-18-visual-upgrade.md) | Linear Precise v2 · EmptyState / ErrorState / LoadingState / FirstRun / Coachmark / 文案字典 | 保留 CLAUDE §3.5 三条纪律 · 用文案 / 留白 / 节奏引入温度 · 不引图标库和 motion 库 |
| [2026-04-18-walkthrough-acceptance.md](./2026-04-18-walkthrough-acceptance.md) | 模拟真人用 chrome-devtools MCP 真点 · 按 N1-N6 北极星维度打分 · **交付前最后一关** · **修-评循环** · 直到全绿或用户显式接受 | 所有其他 spec 全部做完 + self-review + harness-review 之后跑;7 条主动线(W1-W7)覆盖自建 / 自装 / 自派 / 自触发 / 自回滚;Meta Tool `cockpit.run_walkthrough_acceptance`(含 `loop_until_green` / `max_iterations=5` / `auto_fix_p0`);REST `/api/walkthrough/run` + 独立页 `/acceptance`;**写完债务必须修 · 修完必须重跑 · 是闭环不是一次性**;没跑过/没闭环的 plan 不许说 done |

**默认员工装备**(本 spec § 3 强化):`create_employee` 如果不显式指定 `skill_ids`,自动注入:

```python
DEFAULT_SKILL_IDS = ["allhands.render", "allhands.artifacts"]
```

Lead Agent(`is_lead_agent=True`)也同等注入。理由:render 和 artifacts 是"输出"能力,几乎所有员工都要。

**实施顺序**(autopilot 按序推进,避免阻塞):

```
Wave A · 本 spec(Employee + Plan + Dispatch)
   └─ 不依赖其他;独立交付

Wave B · 可并行(与 A 无互锁)
   ├─ 2026-04-18-viz-skill.md            组件库独立
   ├─ 2026-04-18-observatory.md          compose / bootstrap 独立
   └─ 2026-04-18-triggers.md             events 表 + executor · 部分依赖 A 的 run 接口

Wave C · 依赖前两拨
   ├─ 2026-04-18-employee-chat.md        依赖 viz-skill
   ├─ 2026-04-18-artifacts-skill.md      依赖 viz-skill + employee-chat
   └─ 2026-04-18-cockpit.md              依赖 triggers 的 events 表 + observatory 的 health
```

**共享资源**:
- `events` 表 schema 由 cockpit 和 triggers 两份共用;**migration 放在 triggers spec**(首要消费方)。见 [triggers.md § 4.1](./2026-04-18-triggers.md#41)
- `HealthSnapshot.langfuse` 由 observatory spec 提供数据给 cockpit;见 [observatory.md § 10](./2026-04-18-observatory.md#10)

---

## Decision-log

- **2026-04-18**:Skill id 统一用 `allhands.render`(与 L5.8 的 tool 前缀 `allhands.render.*` 对齐),不用 `allhands.viz`。视觉 companion 里出现的 `allhands.viz` 只作演示,最终口径以本 Decision-log 为准。
- **2026-04-18 追加 3 份 spec**:cockpit / triggers / observatory 成立,并入 § 13.5.2。`/` 从"跳 Lead 最近对话"改为 Cockpit,Lead 聊天变成快速操作之一(覆盖 employee-chat.md § 3 的旧路由约定)。`events` 表 schema 由 cockpit + triggers 共享,migration 由 triggers spec 提供。Langfuse 改为 compose 自部署 + bootstrap 自动跑,不再要求用户手工配 API key。
- **2026-04-18 追加 3 份 spec(第四批)**:harness-review / visual-upgrade / walkthrough-acceptance 成立,并入 § 13.5.4。串起来的顺序是 **功能齐 → self-review(3 轮) → harness-review(1 轮) → walkthrough-acceptance(1 轮,最后一关)** → 交付。walkthrough-acceptance 的 6 条北极星子维度(N1-N6)是 P11 的实例化,没跑过不许说 done。blocker 实例:本次会话打开 localhost:3000 触发 E04(`.next` chunk 缺失),沙盒拒 rm -rf · 证明"dev 侧沙盒会拒"是**可复现**的,执行端遇到时按本 spec § 2.4 停下等授权,不要绕。

---

## 14 · 交给 autopilot 前的最后一步

> **本文件由设计端 Claude 出,执行端 Claude 夜跑**。
> 执行端读完 § 0 的必读材料后,按 § 10 的 in-scope 清单逐条做,每做完一条勾掉一个 checkbox。
> 碰到 § 12 的开放问题,按"默认建议"默认落地,同时在 spec 末尾写一条 **"Decision-log"**。
> 碰到 § 9 里标"有重叠"的文件,**先 pull/读最新版,再 patch**,不要覆盖执行端中间产出。
>
> **每个子模块开始实现前**,按 § 13.1 的对标表去 `ref-src-claude` 看一眼 Claude Code 是怎么做的 —— 特别是 AgentRunner 循环 / Tool / Task(dispatch) / TodoWrite(plan)/ Edit 的 diff confirmation。**看完写一条笔记进 commit message**("参考 X 的 Y 模式 → 适配到 Z"),让回头 review 可追溯。Claude Code 在 prompt 设计和工具语义上做得非常精到,抄一点形就能省很多返工。
