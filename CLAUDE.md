# CLAUDE.md · allhands Dev Contract

> **所有进入本项目的贡献者必须先读完本文件再做任何事。** 本文件是开发契约,违反的修改要被拒绝。

---

## 1. 项目速览

**allhands** 是一个开源自部署的"数字员工组织"平台。用户通过与 Lead Agent 对话来设计、调度、观测一支员工团队。详情看 `product/00-north-star.md`。

**当前版本:** v0 MVP。范围看 `product/01-prd.md §3`。

---

## 2. 必读文档(第一次进入仓必须读)

按顺序:

1. [`product/00-north-star.md`](product/00-north-star.md) — 产品哲学、4 条核心设计原则
2. [`product/04-architecture.md`](product/04-architecture.md) — 10 层架构 + 模块边界
3. 本文件 — 开发纪律

其他文档按需:`01-prd.md`、`02-user-stories.md`、`05-roadmap.md`、`adr/`。

**改 `web/` 代码前额外必读:**
- [`product/03-visual-design.md`](product/03-visual-design.md) — 视觉契约 · Linear Precise 规范
- [`product/06-ux-principles.md`](product/06-ux-principles.md) — 交互契约 · 用户友好产品设计(P01…P10)
- [`design-system/MASTER.md`](design-system/MASTER.md) — 组件与 token 速查表

---

## 3. 核心设计原则(必须遵守,违反则打回)

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
- 所有员工走同一 `AgentRunner`(封装 LangGraph `create_react_agent`)
- 模式差异由 `tools[]` / `skill_ids[]` / `max_iterations` 决定

### 3.3 L4 对话式操作 + 护栏

- Tool 必须声明 `scope`(READ / WRITE / IRREVERSIBLE / BOOTSTRAP)
- WRITE 以上默认 `requires_confirmation=True`,不能绕过 `ConfirmationGate`
- BOOTSTRAP 必须走"候选版本 + 显式切换"流程,不能直接生效

### 3.4 低耦合 / 高扩展

- `core/` 禁止 import `sqlalchemy` / `fastapi` / `langgraph` / `langchain` / `openai` / `anthropic`
- 跨层只 import 接口(ABC),不 import 具体实现
- 新能力走"注册"而非"改核心代码"

### 3.5 视觉纪律 · Linear Precise(`web/` 代码必读)

视觉契约在 [`product/03-visual-design.md`](product/03-visual-design.md),速查表在 [`design-system/MASTER.md`](design-system/MASTER.md),活样本在 [`web/app/design-lab/page.tsx`](web/app/design-lab/page.tsx)。

**三条最高纪律:**

1. **禁止第三方 icon 库**(Lucide / Heroicons / Phosphor / Tabler / Font Awesome 等)。图形信息只能来自:排版 · 激活色条 · 点阵 logo · 状态点 · Kbd chip · Mono 字符(`→ ← ⌘ ↵`)· **自有 icon 集 `web/components/icons/**`**(Raycast-style · 2px stroke · round caps · currentColor · 见 ADR 0009)· 5 类 legacy 1-line SVG(`web/components/ui/icons.tsx`:check / arrow-right / external / copy / plus-minus,不再扩展)
2. **颜色密度 ≤ 3** (不含语义状态色)。一律用 token(`bg-bg` `text-text-muted` `bg-primary`...),**禁止** 在 JSX 写十六进制或 `bg-blue-500`、`text-zinc-400` 等 Tailwind 原色类,**禁止** `dark:bg-zinc-900` 并行定义
3. **动效克制**。位移不超过 2px,hover 只改边框亮度;时长走 `--dur-*`;禁止 `scale` / `box-shadow` 做交互反馈;禁止动画库(Framer Motion / GSAP)

**违反以上三条任意一条 → review 直接打回,无协商。**

新增任何 `web/` 组件前,先过一遍 [`design-system/MASTER.md` §0 自检清单](design-system/MASTER.md#0-每次开发前的自检)。Token 或组件契约变更需同步修改:`product/03-visual-design.md`(规范)→ `globals.css` + `tailwind.config.ts`(实现)→ `design-system/MASTER.md`(速查)。

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
