# 00 · North Star

> **本文件是整个项目的最高仲裁文档。** 任何技术决策、设计取舍、功能取舍,如果与本文件冲突,要么改本文件(走 ADR 流程),要么改决策。

---

## 产品一句话

**One for All(代号 `allhands`)—— 一个 Lead Agent 搞定一切。**

用户只通过与 Lead Agent 对话,即可设计、调度、组织、观测一支完整的数字员工团队。平台的所有操作都以 Tool 形式开放给 Lead Agent,UI 是透明的观测和确认面板,不是配置面板。

---

## 目标用户

| 用户画像 | 场景 | 典型诉求 |
|---|---|---|
| **独立开发者 / 小团队技术负责人** | 自部署,给自己或团队用 | 替代"打开 5 个工具手工拼流程",让 agent 团队常驻 |
| **AI 产品团队 PM / 工程师** | 调研场景、内部运营自动化、客服前置 | 快速试出一套可用的"员工编排",不想陷入 LangGraph 底层 |
| **开源社区用户** | 自部署玩,贡献 Skill/MCP | 想要 Dify 级可用性 + LangChain 级可扩展性 |

---

## 差异化(vs 现有玩家)

| 产品 | 主叙事 | 我们的差别 |
|---|---|---|
| **Dify** | 可视化工作流编排 | 我们是对话式操作,UI 是观测而非配置 |
| **n8n / Make** | 节点式自动化 | 我们的"节点"是 Agent,不是函数;Agent 能被 Agent 派遣 |
| **CrewAI / AutoGen** | 多 agent 协作库 | 我们有可观测、可持久、可交付(docker compose up)的完整平台 |
| **LangFlow / Flowise** | LangChain 的可视化拼图 | 我们坚持"Tool First",所有能力同构,不搞节点种类膨胀 |
| **OpenHands / All Hands AI** | 通用软件工程 Agent | 我们聚焦"员工团队组织",不是单 Agent 无限 scope |

**记忆点:** 别人叫"agent 工作流平台",我们叫"**数字员工组织**"。员工有身份、有工具、有上下级、被 Lead 调度、被驾驶舱观测。

---

## 核心设计原则(8 条,排序即优先级 · 原则 1-7 见 [ADR 0011](adr/0011-principles-refresh.md) · 原则 8 见 [ADR 0017](adr/0017-event-sourced-claude-code-pattern.md))

> **每条原则都给出「不变量 / 来源 / 推论 / 回归防御」四段结构。**
>
> 不变量 = 一句可被测试或静态扫描检测的陈述(违反 → review 打回)。来源 = Claude Code / LangGraph / LangChain 的对应抽象,或本仓代码位置,便于读者追溯为什么这么定。推论 = 2-4 条落地指导。回归防御 = 钉住这条原则不退化的测试或 lint 规则。

### 原则 1 · Tool First

**不变量:** 平台每个能力必须有对应 Tool,三类同构 —— `Backend` 有副作用 / `Render` 吐 `{component, props}` / `Meta` 操作平台自身;所有 Tool 共享统一 schema · 注册表 · scope · gate · audit。

**来源:**
- Claude Code · tool 作为能力原子(`ref-src-claude/V04 · tool-call-mechanism`)
- 本仓 · [`backend/src/allhands/core/tool.py`](../backend/src/allhands/core/tool.py) · [`execution/tools/`](../backend/src/allhands/execution/tools/)
- ADR 0003 · ADR 0010(AG-UI Protocol adoption)

**推论:**
- 前端没有"配置页面",只有"对话窗口 + 内联渲染组件"。驾驶舱 / 员工列表 / 员工详情 = Lead Agent 调 render tool 的返回。
- 新增功能 = 注册新 Tool(+ 可能注册新前端组件)。**零页面代码**。
- **2026-04-18 扩展(L01)**:平台的每个 CRUD / 页面操作都要同时暴露成 Meta Tool,让 Lead Agent 全知全能。独立 UI 页面 + Meta Tool **并存**,不是二选一。一份 service 实现、两个入口(REST router + Meta Tool)。

**回归防御:**
- `backend/tests/unit/test_learnings.py::TestL01ToolFirstBoundary` · Agent-managed 资源路由凡有 REST 写操作必须有同名 Meta Tool
- Tool kind / scope 枚举 frozen Pydantic · 擅自加字段编译不过

### 原则 2 · 统一 React Agent

**不变量:** 数据模型里**没有 `mode` 字段**。所有员工(Lead / 专业员工 / subagent)走同一 `AgentRunner`,差异只出在 `tools[]` / `skill_ids[]` / `max_iterations` / `system_prompt` / `model_ref` 这 5 个字段。

**来源:**
- Claude Code · 单一 L4 agent · 无"模式切换"(`ref-src-claude/V02-execution-kernel`)
- LangGraph · `create_react_agent` · 本仓在 `AgentRunner.stream()` 调用
- ADR 0004 · Unified React Agent

**推论:**
- 所谓"计划模式"、"主管模式" = 预置的工具包模板(Skill)。`plan(goal) → steps` 装上就是计划模式,`dispatch_employee` 装上就是主管模式。
- Lead Agent = 装了全套 Meta Tools 的 React Agent,没有特殊代码路径。
- 新的"模式"只能通过新 Skill 实现,**不许**给 employee 表加枚举字段。

**回归防御:**
- `backend/tests/unit/test_no_mode_field.py` · 静态扫 Employee / Conversation schema 不含 `mode`
- Employee Pydantic 模型 frozen

### 原则 3 · Pure-Function Query Loop

**不变量:** `AgentRunner.stream(messages, thread_id)` 是 state 的纯函数 —— 每一轮都**从 runtime 重新计算** `lc_tools` 和 `system_prompt`,runner 自己不藏状态。所有状态在 `SkillRuntime` / 消息历史 / 外部 repo 里,runner 读入、stream 出 `AgentEvent`,不把 LangGraph 类型泄漏出去。

**来源:**
- Claude Code · `query()` while-true 主循环 · 每轮重算 context(`ref-src-claude/V02 § 2.1`)
- LangGraph · graph as state-transform · `thread_id` 在 `config={"configurable": ...}` 里传
- 本仓 · [`execution/runner.py:251-417`](../backend/src/allhands/execution/runner.py#L251-L417) · [`runner.py:224-249`](../backend/src/allhands/execution/runner.py#L224-L249) 的 `_active_tool_ids / _compose_system_prompt`

**推论:**
- Runner 可被任意替换 · 只要满足"(messages, thread_id) → AsyncIterator[AgentEvent]"签名;LangGraph 如果哪天换掉,替换点局限在一个模块。
- **streaming mode 必须是 `messages`**(per-token),不是 `updates` / `values`(整段吐)· runner.py L376-387 注释钉死原因
- **thinking / content 分流** · `_split_content_blocks` 把 extended thinking 的 reasoning 单独 yield `ReasoningEvent`(见 L03 复发修法)
- Runner 内禁用可变类属性缓存;任何跨轮状态走 `SkillRuntime` 或外部 repo。

**回归防御:**
- `backend/tests/unit/test_runner_per_turn_rebuild.py` · 同一 runner 连续两轮 · 第二轮对 active_tool_ids 的修改生效
- `backend/src/allhands/.importlinter` 规则 · `services/` 不许 import `langgraph` / `langchain` / AIMessage 系列

### 原则 4 · Skill = Dynamic Capability Pack

**不变量:** Skill 是**激活式**动态能力包 · **三段渐进加载契约**(ADR 0015):
1. **discovery** — 描述层(descriptor · ≤ 50 字符 · 进 system prompt)永驻 context · O(1) 成本
2. **activation** — `resolve_skill` 被调用时,把 tool_ids + prompt_fragment + **SKILL.md body**(frontmatter 剥离后)塞进 runtime · O(body ≈ 5-20KB)
3. **on-demand** — body 引导 agent 调 `allhands.meta.read_skill_file(skill_id, rel_path)` 沙盒读 `references/` / `templates/` / `scripts/` 等子文件 · O(picked files)

激活后的状态随对话持久化(原则 6 的状态 checkpoint 条款),不丢。

**来源:**
- Claude Code · skill 体系 · discover descriptors + lazy body-load + on-demand references(`ref-src-claude/V05-skills-system § 2.1-2.3`)
- LangChain · `Runnable` 按需组合(概念借用 · 不直接依赖)
- 本仓 · [`execution/skills.py`](../backend/src/allhands/execution/skills.py) · [`execution/skills_body.py`](../backend/src/allhands/execution/skills_body.py) · [`execution/tools/meta/resolve_skill.py`](../backend/src/allhands/execution/tools/meta/resolve_skill.py) · [`execution/tools/meta/skill_files.py`](../backend/src/allhands/execution/tools/meta/skill_files.py)

**推论:**
- 弱模型 context budget 受控:激活成本不随 skill 总大小增长,只随 body 大小 · references/scripts 按需付费
- Skill 的 tool_ids + fragment + 激活状态持久化到 conversation(见原则 6)· uvicorn reload 不丢
- 新增 built-in Skill 不改 core · `skills/builtin/<id>/SKILL.yaml` 放目录就被发现
- Claude-style 的 SKILL.md + `references/` 目录 zip 上传即可直接投产(无需把精华重写进 `prompt_fragment`)
- `read_skill_file` 沙盒死锁在 `install_root/<slug>/` 内 · scope=READ 不过 gate · 对 `..` / 绝对路径 / symlink / > 256KB / 非 UTF-8 一律拒绝

**回归防御:**
- `backend/tests/unit/test_skills.py::test_descriptor_cap` · descriptor ≤ 50 字符
- `backend/tests/integration/test_skill_runtime_persistence.py` · runtime 跨 process 保持(ADR 0011)
- `backend/tests/unit/test_builtin_skill_path.py` · built-in `Skill.path` 非空(ADR 0015)
- `backend/tests/unit/test_skills_body.py` · SKILL.md body 剥 frontmatter + CRLF 规范化(ADR 0015)
- `backend/tests/unit/tools/test_skill_files_sandbox.py` · 路径沙盒七种 case(ADR 0015)
- `backend/tests/integration/test_resolve_skill_body_injection.py` · 激活时 body 进 `resolved_fragments`(ADR 0015)
- `backend/tests/integration/test_read_skill_file.py` · 未激活拒绝 · 逃逸拒绝 · 读 reference 成功(ADR 0015)

### 原则 5 · Subagent 是 Composition 基元

**不变量:** 跨员工协作(`dispatch_employee` 派活给已发布员工 · `spawn_subagent` 即用即弃的子 agent)**必须复用 `AgentRunner`**,不写第二条 agent 代码路径。subagent 有独立 `SkillRuntime` · 独立 tool 预算 · 父 runner 只拿结果摘要。

**来源:**
- Claude Code · Task tool · subagent 是 composition 基元(`ref-src-claude/V02 · subagent-dispatch`)
- LangGraph · subgraph composition · 语义同构
- 本仓 · [`execution/tools/meta/spawn_subagent.py`](../backend/src/allhands/execution/tools/meta/spawn_subagent.py) · [`execution/dispatch.py`](../backend/src/allhands/execution/dispatch.py)

**推论:**
- Spawn 的预算(`max_iterations` / `timeout_seconds`)是硬上限,超时父拿到结构化 `{error, partial}`,不是死等。
- Subagent 的 trace 是父 trace 的子节点(见 ADR 0010 AG-UI),驾驶舱能展开看。
- 不许写第三条"特殊 agent 框架"(工作流引擎 / workflow DSL);要表达复杂协作,只能 spawn + dispatch。

**回归防御:**
- `backend/tests/unit/test_spawn_subagent.py` · 预算 / 超时 / 结果摘要契约
- `backend/tests/integration/test_dispatch_trace.py` · 父子 trace 嵌套关系

### 原则 6 · L4 对话式操作 + 护栏 + Interrupt

**不变量:** 用户通过与 Lead Agent 对话完成**全部**平台操作(L4 能力边界,含自举)。WRITE / IRREVERSIBLE / BOOTSTRAP 的 tool 必须经过 `ConfirmationGate` · BOOTSTRAP 写"候选版本 + 显式切换",旧版本可回滚。

**来源:**
- Claude Code · permission mode(read-only / edit / bash-ok)是 tool-level gate(`ref-src-claude/V04 § 2.1`)
- LangGraph · `interrupt()` / human-in-the-loop · 语义与 ConfirmationGate 同构
- ADR 0005 · Lead Agent L4 Scope

**推论:**
- Tool 必须声明 `scope`(READ / WRITE / IRREVERSIBLE / BOOTSTRAP)· 缺失 → 注册拒绝。
- Gate 不是可选 middleware · `runner.py:307-344` 把 gate 绑在 executor 闭包里,LLM 看不到"不 gate"的版本。
- 测试里跳 gate 只许用 `AutoApprovePolicy` 显式注入,不许改 gate.py。
- 所有工具调用经 trace backend(LangFuse / Observatory),事后可溯源。

**回归防御:**
- `backend/tests/unit/test_runner.py::test_gate_wraps_write_tools` · WRITE+ 必经 gate
- `backend/tests/unit/test_tool_scope.py` · scope 枚举完整 · 未声明 scope 的 tool 注册失败

### 原则 7 · 低耦合 / 高扩展 + 状态可 Checkpoint

**不变量:**
1. **层间 import 契约**:`core/` 是 Pydantic + stdlib 纯领域层,禁止 import `sqlalchemy` / `fastapi` / `langgraph` / `langchain` / `openai` / `anthropic`;依赖严格自上而下(L10 → L1),禁循环。
2. **注册式扩展**:新能力走注册(ToolRegistry / ComponentRegistry / MCPClient / ModelGateway),不走"改核心代码"。
3. **状态可持久化**:**所有影响后续决策的 runtime 状态必须可 checkpoint 到 L3(持久层),进程重启可 resume**。包括:SkillRuntime(激活过的 skill)· Conversation 消息 · Confirmation 挂起态 · Artifact 内容。

**来源:**
- LangGraph · `Checkpointer` 协议 · 状态外置到 SQLite / Postgres
- Claude Code · `--resume <session>` · 基于消息表 replay
- 本仓 · ADR 0001 · import-linter 规则 · ADR 0011(状态可 checkpoint 的正式契约)

**推论:**
- `core/` 纯 Pydantic · 业务可单元测试 · 不跑 DB 也能测域模型。
- 任何"内存字典"作为状态都是反模式,除非旁边有一份 repo 版本同步落地。
- `SkillRuntime` 重启不丢(从 v1 起 · 见 [ADR 0011 §3](adr/0011-principles-refresh.md))。
- 未来要完整 LangGraph Checkpointer · 单独 ADR · 本条只要求"状态可持久化",不强制 framework。
- **消息恢复路径 · ADR 0014 R3**(2026-04-23):用户可见历史由 MessageRepo 承载 · LLM 短期记忆由 checkpointer 承载 · 每轮只送 delta(新 user 输入) · 冷启自动 bootstrap · compaction 整理账本时不影响 LLM 上下文。详见 [ADR 0014 R3](adr/0014-langgraph-checkpointer.md#r3--dual-sot-消息恢复路径--delta-send-契约)。

**回归防御:**
- `backend/pyproject.toml` · `.importlinter` 配置 · 跑 `uv run lint-imports`
- `backend/tests/integration/test_skill_runtime_persistence.py` · cache miss → repo load · 进程边界模拟
- `backend/tests/integration/test_dual_sot_delta_consistency.py` · compaction 下 LLM 上下文不掉(ADR 0014 R3)

### 原则 8 · 参考系统 · Claude Code 为首要架构参考(新 · 见 [ADR 0017](adr/0017-event-sourced-claude-code-pattern.md))

**不变量:** 参考系统的优先级明确 —— **Claude Code(`ref-src-claude/`)是首要参考**;LangGraph / LangChain 等框架仅作"工具编排 + interrupt 原语"等局部引擎使用,**不作消息历史 / resume / subagent / 压缩的 SoT**。任何"是否该用某框架的 X 机制"的架构讨论,先问"Claude Code 怎么做的";框架默认做法与 Claude Code 模式冲突时,**Claude Code 优先**。

**来源:**
- Claude Code · 全量实现源码参考(`ref-src-claude/INDEX.md` · `volumes/V01-V11`)· 18 个月生产环境验证的 LLM agent 产品架构
- ADR 0017 · 事件日志 + 纯投影对齐 · 把 Claude Code 立为首要参考
- L19 · 不要被 LangGraph 抽象绑架 · 方法论基石

**推论:**
- **消息历史 = append-only 事件日志**(对标 Claude `{sessionId}.jsonl`)· 不是 MessageRepo + Checkpointer dual-SoT
- **LLM 上下文 = 纯函数每轮重算投影**(对标 `normalizeMessagesForAPI`)· 不是 delta-send + reducer dedup
- **每轮发全量 + provider prompt caching**(对标 Anthropic `cache_control`)· 不搞客户端 delta 优化
- **Resume / fork / regenerate 全部走事件日志遍历**(对标 `parentUuid` DAG + `buildConversationChain`)· 不搞框架特定机制
- **Subagent 独立 sidechain**(对标 `agent-{id}.jsonl`)· 不叠在主 conversation state 里
- **Auto-compact 带熔断器 + PTL fallback**(对标 `autoCompact` V08 § 2.2-2.3)· 不裸奔
- **引入新框架时评审口径**:"这个框架解决的问题和我们架构的职责是否混淆 · 它的默认做法和 Claude Code 模式是否冲突 · 冲突时谁让步"

**回归防御:**
- ADR 0017 立契约 · 任何违反事件日志 SoT / 纯投影 / 全量发送的 PR · review 打回
- `uv run lint-imports` · `langgraph.checkpoint.*` 不泄出 `execution/`(ADR 0014 R1 继续生效)· 新增 `langgraph.graph.*` 同等守护(Phase 1 落地时加)
- P1-P4 回归测试套件(见 ADR 0017 · Regression defense)验证:事件日志作唯一 SoT · `messages` 表作 projection cache · `build_llm_context` 纯函数性 · turn abort 合成 assistant 注入
- 未来引入新大型框架 · 必须在 PR 说明里回答"是否与 Claude Code 模式冲突"· reviewer 按 L19 打回

---

## 非目标(v0/v1 明确不做)

- ❌ 可视化工作流编辑器(违反 Tool First + 对话式操作)
- ❌ 内置 RAG 引擎(Skill / MCP 外接即可)
- ❌ 向量数据库(v2+ 再议)
- ❌ 多租户(v0 单实例;SaaS 是 v4+ 的故事)
- ❌ 计费 / Usage 限流(同上)
- ❌ 内置 UI 配置面板(除 v1 的驾驶舱;核心配置通过与 Lead Agent 对话)
- ❌ 非 OpenAI-compatible 的模型协议(v0 写死单协议,v1 再抽象 ModelGateway)

---

## 衡量标准(North Star Metric 候选)

**v0 发布时的 North Star:**

> 用户能通过与 Lead Agent 一句话对话,完成"调研 LangGraph vs CrewAI 并产出 markdown 报告"的完整任务,且全过程在 LangFuse 中有完整嵌套 trace,耗时 < 5 分钟、成本 < $0.50。

这条任务覆盖:Lead Agent 对话、create_employee(需 confirmation)、dispatch_employee(Supervisor 语义)、MCP web_search、React Agent 执行、Render Tool、LangFuse。

---

## 品牌说明

- **项目代号 / 仓库名:** `allhands`
- **品牌冲突提示:** `allhands.dev` 已被 All Hands AI(OpenHands 的商业实体)占用。**代号仅内部使用**。对外发布前需确定正式品牌,届时做全量 rename(走 ADR)。
- **License:** MIT(可改)

---

## 本文件的边界

- ✅ 产品哲学、差异化、核心原则、非目标
- ❌ 具体功能清单 → 看 `01-prd.md`
- ❌ 用户故事 → 看 `02-user-stories.md`
- ❌ 视觉规范 → 看 `03-visual-design.md`
- ❌ 技术架构 → 看 `04-architecture.md`
- ❌ 版本计划 → 看 `05-roadmap.md`

**任何改动本文件必须走 ADR 流程(在 `adr/` 下创建一条)。**
