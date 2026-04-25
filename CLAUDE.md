# CLAUDE.md · allhands Dev Contract

> **所有进入本项目的贡献者必须先读完本文件再做任何事。** 本文件是开发契约,违反的修改要被拒绝。

---

## 1. 项目速览

**allhands** 是一个开源自部署的"数字员工组织"平台。用户通过与 Lead Agent 对话来设计、调度、观测一支员工团队。详情看 `product/00-north-star.md`。

**当前版本:** v0 MVP。范围看 `product/01-prd.md §3`。

---

## 2. 必读文档(第一次进入仓必须读)

按顺序:

1. [`product/00-north-star.md`](product/00-north-star.md) — 产品哲学、8 条核心设计原则(原则 1-7 见 ADR 0011 · 原则 8 · 参考系统 见 ADR 0017)
2. [`ref-src-claude/INDEX.md`](ref-src-claude/INDEX.md) — **Claude Code 实现参考(首要架构参考 · 见原则 8 / ADR 0017)**
3. [`product/04-architecture.md`](product/04-architecture.md) — 10 层架构 + 模块边界
4. 本文件 — 开发纪律

其他文档按需:`01-prd.md`、`02-user-stories.md`、`05-roadmap.md`、`adr/`。

**改 `web/` 代码前额外必读:**
- [`product/03-visual-design.md`](product/03-visual-design.md) — 视觉契约 · Linear Precise 规范
- [`product/06-ux-principles.md`](product/06-ux-principles.md) — 交互契约 · 用户友好产品设计(P01…P10)
- [`design-system/MASTER.md`](design-system/MASTER.md) — 组件与 token 速查表

---

## 3. 核心设计原则(必须遵守,违反则打回)

> **8 条原则 · 排序即优先级。** 完整版在 [`product/00-north-star.md § 核心设计原则`](product/00-north-star.md#核心设计原则8-条排序即优先级--原则-1-7-见-adr-0011--原则-8-见-adr-0017) · 每条的"不变量 / 来源 / 推论 / 回归防御"四段结构在那里。本节是 **review 时的快速对照速查**。
>
> 本次 v1 refresh 见 [ADR 0011](product/adr/0011-principles-refresh.md)(4 条 → 6 条 · 参考 Claude Code + LangGraph 核心抽象)。
>
> **2026-04-24 新增原则 8 · 参考系统**(见 [ADR 0017](product/adr/0017-event-sourced-claude-code-pattern.md)):Claude Code(`ref-src-claude/`)是首要架构参考 · LangGraph 仅作局部工具编排引擎 · 不作消息历史 / resume / subagent / 压缩的 SoT。事件日志 + 纯投影替代 dual-SoT + delta-send。

### 3.1 Tool First(2026-04-18 扩展版 · 见 L01)

> **Tool 是 Agent 的能力边界;平台的每个能力都要同时暴露成 Meta Tool,让 Lead Agent 通过对话能做用户在 UI 上能做的任何事。**
> 原则不是"Agent 代做的才是 Tool",而是 **"Agent 全知全能 = 平台能力都有对应 Tool"**。独立 UI 页面与 Meta Tool **并存**,不是二选一。

- **一份实现,两个入口**:后端 service 层写一份业务逻辑;上面叠两层 API —— `routers/` 给 UI 用户直接操作,`execution/tools/meta/` 给 Lead Agent 对话调用。两者语义等价,不允许功能漂移
- **Agent-managed 资源(员工 / Skill / MCP / Provider / Model)** 的每一个 CRUD 操作和页面按钮行为都必须有**对应的** Meta Tool(即使独立页已经在用 REST)
- **前端允许独立 CRUD 页 + 页面操作按钮**(Gateway / Skills 管理 / MCP 管理 / 员工管理等),走 REST 直调;**同时**必须确认对应能力已在 Meta Tool 注册
- REST-only(不需要 Meta Tool)场景:**Bootstrap 候选版本切换** / **只读列表浏览(Traces)** / **敏感凭证直输(API key)** / Confirmation Gate 回执 / 对话消息收发本身
- 回归测试(`test_learnings.py::TestL01ToolFirstBoundary`)验证:Agent-managed 路由凡有 REST 写操作 → 必须有同名语义 Meta Tool(两个入口必须成对)

### 3.2 统一 React Agent

- 数据模型里**没有 `mode` 字段**。PR 里出现 `mode` 字段立即打回
- 所有员工走同一 `AgentLoop`(`execution/agent_loop.py` · `AgentRunner` 是面向旧调用者的 facade)
- 模式差异由 `tools[]` / `skill_ids[]` / `max_iterations` / `system_prompt` / `model_ref` 决定(只有这 5 个字段)
- "新增一种模式" = 加 Skill 或 Tool,**不许**给 Employee / Conversation 加枚举字段

### 3.3 Pure-Function Query Loop(2026-04-25 落到代码 · ADR 0018)

- `AgentLoop.stream(messages)` 是 state 的纯函数 —— **每一轮都重新计算** `lc_tools` + `system_prompt`,loop 自己不藏状态
- 所有状态在 `SkillRuntime` / 消息历史 / 外部 repo 里(MessageRepo + ConfirmationRepo + SkillRuntimeRepo · 唯一 SoT)· loop 读入,yield `InternalEvent`(terminal + preview 两层)
- 内部事件协议:`AssistantMessageCommitted` / `ToolMessageCommitted` / `ConfirmationRequested` / `LoopExited(5 reasons)` / `AssistantMessagePartial` / `ToolCallProgress`
- AG-UI 翻译只在 `api/ag_ui_translator.py`,`execution/` 不直接 import AG-UI 类型(import-linter 守护)
- 参考:Claude Code `query()` while-true 主循环 · ADR 0018 落地实现
- 回归:`test_agent_loop.py` · `test_tool_pipeline.py` · `test_internal_events.py` · import-linter "no langgraph anywhere"

### 3.4 Skill = Dynamic Capability Pack(新 · v1)

- Skill 是**激活式**动态能力包 · **三段渐进加载**(ADR 0015):
  1. **descriptor 永驻**:name + ≤ 50 字符 description 进 system prompt
  2. **激活时注入 body**:`resolve_skill` 被调用时,把 `tool_ids` + `prompt_fragment` + **SKILL.md 正文 body**(去 frontmatter)塞进 runtime
  3. **按需拉资源**:body 引导 agent 自主调 `allhands.meta.read_skill_file(skill_id, relative_path)` 读 `references/` / `templates/` / `scripts/` 等子文件(scope=READ · 沙盒限死 `install_root/<slug>/` 内 · ≤ 256KB · UTF-8)
- 激活后的 `SkillRuntime` 状态**必须持久化**到 conversation(见 3.7 状态可 checkpoint 条款)· uvicorn reload 不丢
- 弱模型的 context budget 受控:descriptor O(1) · activation O(body ≈ 5-20KB) · on-demand O(picked)
- 新增 Skill = `skills/builtin/<id>/SKILL.yaml` 放目录就被发现;Claude-style 的 SKILL.md + `references/` 目录上传 zip 即可直接投产
- 参考:Claude Code skill 体系 descriptor + lazy body-load(`ref-src-claude/V05 § 2.1-2.3`)· ADR 0015
- 回归:`test_skills.py::test_descriptor_cap` · `test_skill_runtime_persistence.py`(ADR 0011)· `test_skills_body.py` · `test_skill_files_sandbox.py` · `test_resolve_skill_body_injection.py` · `test_read_skill_file.py`(ADR 0015)

### 3.5 Subagent 是 Composition 基元(新 · v1)

- 跨员工协作(`dispatch_employee` · `spawn_subagent`)**必须复用 `AgentRunner`**,不许写第二条 agent 代码路径
- Subagent 有独立 `SkillRuntime` · 独立 `max_iterations` / `timeout_seconds` 预算;超时返回 `{error, partial}`,不死等
- Subagent trace 是父 trace 的子节点(AG-UI / Observatory 展开看)
- **不许**写"工作流引擎 / workflow DSL" —— 复杂协作只能 spawn + dispatch
- 参考:Claude Code Task tool · LangGraph subgraph composition
- 回归:`test_spawn_subagent.py` · `test_dispatch_trace.py`

### 3.6 L4 对话式操作 + 护栏 + Deferred Tool

- Tool 必须声明 `scope`(READ / WRITE / IRREVERSIBLE / BOOTSTRAP)· 未声明 → 注册拒绝
- WRITE 以上 + `requires_confirmation=True` 走 **DeferredSignal**(`execution/deferred.py`)· `_permission_check` 返回 `Defer(signal, kwargs)` · pipeline 自动 publish/wait
- READ + `requires_user_input=True` 同样走 **DeferredSignal**(ADR 0019 C3) · 由 `UserInputDeferred` 提供 · 答案在 `outcome.payload` · pipeline 注入 `block.input` 后调 executor
- BOOTSTRAP 必须走"候选版本 + 显式切换"流程,不能直接生效
- 测试里跳 confirmation:用 `AutoApproveGate` 或不注入 `confirmation_signal`,Allow 默认通过
- 参考:Claude Code `shouldDefer: true` tool · ADR 0018 deferred tool 一等公民 · ADR 0019 C3 第二个 impl 验证通用性
- 回归:`test_agent_loop.py` · `test_tool_pipeline.py` · `test_deferred.py` · `test_user_input_deferred.py` · `test_user_input_agent_loop.py`

#### 3.6a · Plan as a Tool(ADR 0019 C1)

- agent 调 `plan_create` / `plan_update_step` / `plan_complete_step` / `plan_view` 维护内部 todo · scope=WRITE 但 `requires_confirmation=False`(不动外部系统)
- `plan_view` 返回 render envelope · 前端 `PlanTimeline.tsx` 渲染时间线 · 用户实时看进度
- **不做 plan mode** · 没有 conversation.permission_mode · 没有 enter/exit 仪式 · 没有权限 gating(后期审查再加)
- AgentLoop ctor 注入 `plan_repo` + `conversation_id` · `_maybe_substitute_executor` 把 4 个 plan tool 的 stub 替换成 repo-bound executor
- 回归:`test_plan_executors.py`(16 tests)

#### 3.6b · Sub-agent Trace Drawer(ADR 0019 C2)

- `dispatch_employee` / `spawn_subagent` tool result 包含 `run_id`(子 run 的 trace 锚)
- 前端 ToolCallCard expand 区 duck-type 检测 `result.run_id` · 渲染 `TraceChip(variant=link)` · 点击设 `?trace=<run_id>` · 现有 `RunTraceDrawer` 滑出
- 复用现有 `RunTracePanel` + `fetchRunDetail` · 零新组件
- 实时 stream-through(子事件流回父流)留作后续 follow-up · 当前 drawer 已能拉子 run 完整细节

### 3.7 低耦合 / 高扩展 + 状态可 Checkpoint(v1 扩展)

**三条不变量:**

1. **层间 import 契约**:`core/` 禁止 import `sqlalchemy` / `fastapi` / `langchain` / `openai` / `anthropic`;`langgraph` 全仓 forbid(ADR 0018)· 跨层只 import 接口(ABC),不 import 具体实现;依赖方向严格自上而下(L10 → L1)
2. **注册式扩展**:新能力走注册(ToolRegistry / ComponentRegistry / MCPClient / ModelGateway),不走"改核心代码"
3. **状态终态化(2026-04-25 · ADR 0018)**:所有影响后续决策的 runtime 状态**必须可从 repo 完整重建** —— 进程重启 / uvicorn reload 不丢
   - 任何"内存 dict"作为状态都是反模式 · 除非旁边有 repo 同步落地
   - `SkillRuntime` 在 `chat_service.send_message` 结束时 flush 到 `SkillRuntimeRepo`(ADR 0011)
   - **ADR 0018(2026-04-25):** LangGraph Checkpointer 已被 ADR 0018 移除 · 状态 SoT 只剩 `MessageRepo` + `ConfirmationRepo` + `SkillRuntimeRepo` · 挂起 / 恢复经由 `DeferredSignal`(轮询 ConfirmationRepo · 协程 await)· import-linter "no langgraph anywhere" 守护

- 参考:Claude Code 自有 query 循环 · 全部状态在 messages list + repos
- 回归:`lint-imports` · `test_skill_runtime_persistence.py` · `test_deferred.py` · `test_agent_loop.py`

### 3.8 视觉纪律 · Brand Blue Dual Theme(`web/` 代码必读)

> **2026-04-23 更新:** 旧 "Linear Precise" 契约已通过 [ADR 0016](product/adr/0016-brand-blue-dual-theme.md) 全面替换为 **Brand Blue Dual Theme** · 双主题(light / dark)· theme pack 可扩展架构。原 "三条最高纪律"(禁 Lucide / 颜色密度 ≤ 3 / 动效 2px 上限)· BAN 1(colored border-accent)· BAN 2(gradient text)**全部作废**。

视觉契约在 [`product/03-visual-design.md`](product/03-visual-design.md),速查表在 [`design-system/MASTER.md`](design-system/MASTER.md),活样本在 [`web/app/design-lab/page.tsx`](web/app/design-lab/page.tsx),原型在 [`design-system/proposals/`](design-system/proposals/)(V1 Cobalt Precision 暗 · V2 Azure Live 浅)。

**五条设计原则:**

1. **跨主题一致性** — light 和 dark 必须传递同一份信息语义(激活 / 层级 / 状态区分方式一致,只换色值)。e2e 视觉回归两个主题各跑一次
2. **Token 优先** — 一切颜色 / 字号 / 圆角 / 阴影 / 动效走 token · 禁止 JSX 里写十六进制或 `bg-blue-500` / `text-zinc-400` 这类 Tailwind 原色类;**禁止** `dark:bg-*` 并行定义(theme 切换走 `data-theme` + CSS 变量自动完成)
3. **扩展性设计** — 组件只消费 token 接口(`bg-primary` / `text-text-muted` 等),不依赖具体 theme pack。新 theme pack = 新建 `web/styles/themes/<pack>/{light,dark}.css`,组件零改动
4. **品牌可感** — 允许 gradient text(hero h1)· colored accent / hairline(卡片顶条)· shadow-glow(暗主题 primary 发光)· mesh gradient hero 建立产品识别
5. **动效克制** — 允许 `hover:-translate-y-px` · `animate-float`(装饰 orb)· `pulse-ring`(状态点)· `shadow-glow` 反馈;**禁止** Framer Motion / GSAP 等 JS 动画库(CSS + Tailwind keyframes 足够);禁止持续闪烁干扰阅读

**Icon 体系:**

- 业务 icon 统一经 `<Icon name="..." />` 包装(`web/components/ui/icon.tsx` · 底层 lucide-react)· **禁止**直接 `import { X } from 'lucide-react'`
- 特殊符号(app logo · provider brand marks · 装饰字符):走 `web/components/icons/` 自有集 · `<BrandMark />`(ADR 0009 降级条款)

**主题切换:**

- 实装 `next-themes` · `<html data-theme-pack="brand-blue" data-theme="light|dark|system">`
- 默认 `data-theme-pack="brand-blue"`;加第二个 pack 时在 `ThemeProvider` 注册即可
- 切换入口:topbar 右上角 + settings 页

新增任何 `web/` 组件前,先过一遍 [`design-system/MASTER.md` §0 自检清单](design-system/MASTER.md#0-每次开发前的自检清单)。Token / 组件契约变更同步路径:`product/03-visual-design.md`(规范)→ `web/styles/themes/brand-blue/*.css`(实现)→ `tailwind.config.ts`(映射)→ `design-system/MASTER.md`(速查)。

**违反原则 1-3 → review 打回。** 原则 4-5 允许在 code review 讨论具体边界。

---

## 4. 目录结构

```
allhands/
├── product/               # 产品与架构文档(改动走 ADR)
├── backend/
│   ├── src/allhands/
│   │   ├── core/          # L4 领域(纯 Pydantic)
│   │   ├── persistence/   # L3 SQLAlchemy + repos
│   │   ├── observability/ # L2 LangFuse
│   │   ├── execution/     # L5 AgentRunner / ToolRegistry / Gate / MCP
│   │   ├── services/      # L6 应用服务
│   │   ├── api/           # L7 FastAPI routers + L8 protocol
│   │   ├── config/        # 环境配置
│   │   └── main.py        # 入口
│   ├── tests/
│   │   ├── unit/
│   │   └── integration/
│   ├── alembic/
│   ├── pyproject.toml
│   └── ruff.toml
├── web/
│   ├── app/               # L9 Next.js App Router
│   ├── components/        # L10 展示组件
│   ├── lib/               # L9 SSE/state/registry
│   ├── public/
│   └── package.json
├── docker-compose.yml
├── .env.example
├── .claude/
│   ├── skills/
│   │   └── allhands-dev/SKILL.md  # 本项目核心原则(简短版)
│   └── settings.json              # 项目级 hooks
├── CLAUDE.md                       # 本文件
├── README.md
└── LICENSE
```

---

## 5. 常用命令

### 5.1 启动开发环境

```bash
# 一键启动(推荐,首次)
docker compose up --build

# 后端本地开发(热重载)
cd backend
uv sync
uv run uvicorn allhands.main:app --reload --port 8000

# 前端本地开发
cd web
pnpm install
pnpm dev
```

### 5.2 测试 / 静态检查

```bash
# 后端
cd backend
uv run pytest                    # 全部测试
uv run pytest tests/unit         # 仅 unit
uv run ruff check .              # lint
uv run ruff format --check .     # format check
uv run mypy src                  # 类型检查
uv run lint-imports              # 分层边界检查

# 前端
cd web
pnpm test                        # vitest(单元 + 静态契约扫描)
pnpm test:e2e                    # playwright(视觉回归)
pnpm lint                        # eslint
pnpm typecheck                   # tsc --noEmit
pnpm build                       # 生产构建(typecheck + build)
```

### 5.3 数据库

```bash
cd backend
uv run alembic upgrade head            # 应用所有 migration
uv run alembic revision -m "..."       # 新建 migration
uv run alembic downgrade -1            # 回滚一步
```

### 5.4 全量检查(CI 同款)

```bash
./scripts/check.sh   # 所有 lint + type + test,任何失败退出非零
```

---

## 6. 开发纪律

### 6.1 TDD

**流程:**
1. 先写失败的测试
2. 写最少的代码让测试通过
3. 重构

**例外:** 脚手架、配置文件、迁移文件不需要 TDD。

### 6.2 Lint / Type 必须绿

**PR / commit 前:**
- `ruff check .` 零警告
- `mypy src` 零错误(strict 模式)
- `lint-imports` 零违规(分层契约)
- `pnpm lint` + `pnpm typecheck` 零错误

### 6.3 Import 分层契约(硬规则)

- `core/` 只依赖 `pydantic` + stdlib
- `persistence/` 依赖 `core/`(+ sqlalchemy)
- `execution/` 依赖 `core/` + `persistence/` + langgraph 等
- `services/` 依赖 `core/` / `persistence/` / `execution/` / `observability/`
- `api/` 依赖 `services/` + `core/`(用于 DTO)
- `observability/` 依赖 `core/` + langfuse

`import-linter` 在 pre-commit 强制。违反 → commit 拒绝。

### 6.4 新增 Tool 的流程(示例)

要加一个新 Backend Tool `fetch_url`:

1. 在 `backend/src/allhands/execution/tools/fetch.py` 写:
   ```python
   TOOL = Tool(
       id="allhands.builtin.fetch_url",
       kind=ToolKind.BACKEND,
       name="fetch_url",
       description="Fetch a URL and return its text content. Use for web pages or JSON APIs.",
       input_schema={...},
       output_schema={...},
       scope=ToolScope.READ,
       requires_confirmation=False,
   )
   async def executor(url: str, timeout: int = 10) -> str: ...
   ```

2. 在 `tools/__init__.py` 的 `discover_builtin_tools()` 里导入并注册

3. 写 unit test:`tests/unit/tools/test_fetch.py`

4. 写 integration test(若涉及网络):`tests/integration/tools/test_fetch.py`

5. 如果 Skill 需要它,更新对应 `skills/*.yaml`

**不修改任何其他代码**。这是 Tool First 的验证:新 Tool = 新文件 + 注册一行。

### 6.5 新增 Render Tool + 前端组件

1. 后端 render tool 返回 `{component: "MyThing", props: {...}}`
2. 前端 `web/components/render/MyThing.tsx` 写组件
3. 前端 `web/lib/component-registry.ts` 加 `MyThing: MyThingComponent`
4. 协议 schema 在 `backend/src/allhands/api/protocol.py` 和 `web/lib/protocol.ts` 同步更新(加 props 类型)
5. 前后端 schema 一致性测试:`tests/integration/test_render_protocol.py`

### 6.6 Confirmation Gate 不能绕过

- Tool 声明了 `scope >= WRITE` 就必须经过 `ConfirmationGate`
- 测试里若需要跳过 gate,用 `AutoApprovePolicy` 注入(仅限测试)

### 6.7 禁止的行为

- ❌ 在 `core/` 里 import 框架
- ❌ 在数据库表中加 `mode` 字段(员工或会话)
- ❌ 为员工/MCP/Skill 开 REST CRUD endpoint(必须走 Meta Tool)
- ❌ 为员工管理写独立前端页面(必须走 Lead Agent + render tool)
- ❌ Tool 不声明 `scope` / 不经 Gate
- ❌ 不带测试的实现 PR
- ❌ LangGraph / LangChain 类型出现在 `services/` 以上(必须被 `execution/` 封装)

---

## 7. 提交规范

- Conventional Commits:`feat(scope): ...` / `fix: ...` / `refactor: ...` / `docs: ...` / `test: ...` / `chore: ...`
- commit message 说 **为什么**,不只是**什么**
- PR 必须关联 ADR / user story(如果适用)

---

## 8. ADR 流程

**涉及架构或产品哲学的决策 → 新增一条 ADR。**

1. `product/adr/NNNN-<slug>.md`,编号递增
2. 模板:Context / Decision / Rationale / Consequences / Alternatives
3. 更新相关产品文档引用这条 ADR
4. PR 里 reviewer 确认 ADR

---

## 9. 有疑问时的优先级

1. 本文件(CLAUDE.md)
2. `product/04-architecture.md`
3. `product/00-north-star.md`
4. ADR
5. 其他 product 文档

**冲突时高优先级覆盖低优先级。** 发现冲突 → 立刻停,问 maintainer / 提 ADR。
