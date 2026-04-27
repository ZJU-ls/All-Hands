# allhands

> **One for All** — 一个 Lead Agent 搞定一切。
> 开源自部署的"数字员工组织"平台,对话式操作,Tool First。

**Status:** v0 MVP · 开发中

---

## 核心能力(v0)

- 🧑‍💼 **Lead Agent** — 你的唯一入口。对话式完成员工 CRUD、派遣、观测
- 🔧 **Tool First** — 所有能力皆 Tool(Backend / Render / Meta)
- 🔁 **统一 React Agent** — 所有员工同一架构,区别仅在工具集
- 🧩 **MCP 挂载** — stdio / SSE / HTTP 三种 transport
- 📋 **Plan Tool** — Claude Code TodoWrite 风格的单工具 todo list,弱模型也能稳定用
- 📁 **Skill Files** — 浏览 / 编辑 skill 源码 · CodeMirror 6 + 沙盒
- 🔭 **自建 Observatory** — 全链路 trace · 制品 / token / 延迟可观测,无外部依赖

---

## 快速开始

**前置依赖:**
- Python 3.13(由 [uv](https://github.com/astral-sh/uv) 管理)
- Node.js 20+ + [pnpm](https://pnpm.io/)
- 一个 OpenAI-compatible 的 API key(OpenAI / DeepSeek / 阿里百炼 / Anthropic 兼容代理 都行)

### 1 · 一键启动(推荐)

```bash
git clone <this-repo> allhands
cd allhands
./scripts/dev.sh
```

`dev.sh` 自动:
- 后端:`alembic upgrade head` + `uvicorn allhands.main:app --reload --port 8000`
- 前端:`pnpm dev` on `:3000`

第一次跑前装一下依赖:

```bash
cd backend && uv sync
cd ../web   && pnpm install
```

### 2 · 分开手动启动

**后端**

```bash
cd backend
uv sync                                  # 装依赖(只第一次)
uv run alembic upgrade head              # 初始化 / 升级数据库
uv run uvicorn allhands.main:app --reload --port 8000
```

**前端(另一个终端)**

```bash
cd web
pnpm install                              # 装依赖(只第一次)
pnpm dev                                  # 起 :3000 dev server
```

### 3 · 打开浏览器

| 入口 | URL |
|---|---|
| Web UI | <http://localhost:3000> |
| Backend API | <http://localhost:8000/api/health> |
| Observatory | <http://localhost:3000/observatory> |

---

## 配置 LLM Gateway

启动后,首次进入会让你配 provider:

1. 打开 **<http://localhost:3000/gateway>**
2. 点 **「+ 添加 Provider」**,从预设里挑一家(OpenAI / Anthropic / 阿里百炼 / OpenRouter ...)
3. 粘贴 API key + base_url,点「测试连通」确认 OK
4. 注册一个具体的 model(如 `qwen3-plus` / `gpt-4o-mini`),点「设为默认」

完成后回到 `/chat` 就能跟 Lead Agent 对话了。

> **`.env` 是可选的。** 项目所有 provider / model / 默认模型都通过 UI 配置并存在本地 SQLite 里。`.env.example` 里的 `OPENAI_API_KEY` 之类只在你想用环境变量预设而不是 UI 输入时才需要。

---

## 数据存放在哪

| 位置 | 内容 |
|---|---|
| `backend/data/app.db` | 主 SQLite 数据库 · provider / 员工 / 对话 / 制品元数据 |
| `backend/data/skills/` | 用户安装的 skill(zip / GitHub clone)|
| `backend/skills/builtin/` | 平台内置 skill(跟随代码发布) |
| `backend/data/artifacts/` | agent 产出的 markdown / 代码 / 图片 / drawio blob |
| `backend/data/kb/` | 知识库 BM25 + 向量索引 |

设置页 `/settings/system` 显示这些路径,所有目录都能用 `ALLHANDS_*` 环境变量覆盖。

---

## 文档

| 文档 | 用途 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | **开发契约(Claude 会话必读)** |
| [product/00-north-star.md](product/00-north-star.md) | 产品哲学 + 8 条设计原则 |
| [product/01-prd.md](product/01-prd.md) | PRD |
| [product/02-user-stories.md](product/02-user-stories.md) | 用户故事 + 验收标准 |
| [product/03-visual-design.md](product/03-visual-design.md) | 视觉系统 + design tokens |
| [product/04-architecture.md](product/04-architecture.md) | 10 层技术架构 |
| [product/05-roadmap.md](product/05-roadmap.md) | 版本演进 |
| [product/adr/](product/adr/) | 架构决策记录 |
| [ref-src-claude/INDEX.md](ref-src-claude/INDEX.md) | Claude Code 实现参考(架构对标) |

---

## 常用命令

### 开发

```bash
./scripts/dev.sh              # 一键启 backend + web 双 watch 模式
./scripts/check.sh            # 全量 lint + type + test(后端 + 前端)
```

### 后端

```bash
cd backend
uv run pytest                                # 全部测试
uv run pytest tests/unit                     # 仅 unit
uv run ruff check .                          # lint
uv run ruff format .                         # format
uv run mypy src                              # 类型检查
uv run lint-imports                          # 分层契约检查
uv run alembic revision -m "..."             # 新建 migration
uv run alembic upgrade head                  # 应用 migration
uv run alembic downgrade -1                  # 回滚一步
```

### 前端

```bash
cd web
pnpm dev                                     # dev server :3000
pnpm test                                    # vitest(单元 + 静态契约)
pnpm test:e2e                                # playwright(视觉回归)
pnpm lint                                    # eslint
pnpm typecheck                               # tsc --noEmit
pnpm build                                   # 生产构建
```

---

## 项目结构

```
allhands/
├── backend/
│   ├── src/allhands/
│   │   ├── core/             # L4 领域模型(纯 Pydantic)
│   │   ├── persistence/      # L3 SQLAlchemy + repos
│   │   ├── observability/    # L2 自建 trace ledger
│   │   ├── execution/        # L5 AgentLoop / ToolRegistry / Skills / MCP
│   │   ├── services/         # L6 应用服务
│   │   ├── api/              # L7 FastAPI routers + L8 protocol
│   │   ├── config/           # 环境配置
│   │   └── main.py           # 入口
│   ├── tests/{unit,integration}/
│   ├── alembic/              # DB migrations
│   └── skills/builtin/       # 平台内建 skill(yaml + markdown)
├── web/
│   ├── app/                  # L9 Next.js App Router
│   ├── components/           # L10 展示组件
│   ├── lib/                  # SSE / state / registry
│   └── i18n/messages/        # zh-CN + en
├── product/                  # 产品 + 架构文档
├── scripts/
│   ├── dev.sh                # 一键启
│   └── check.sh              # 全量 CI 同款检查
├── CLAUDE.md
└── README.md
```

---

## 故障排查

**backend 起不来 · `alembic` 报 schema 错**

```bash
cd backend
rm data/app.db                               # 第一次跑可以直接清,以后不要
uv run alembic upgrade head
```

**`pnpm dev` 报「找不到包」**

```bash
cd web
rm -rf node_modules .next
pnpm install
```

**LLM 报「empty response」/「thinking rejected」**

去 `/gateway` 改一下 model 的「思考」开关 · 不同 anthropic-compat 反代对 `thinking` 字段支持不一致。

**`spawn_subagent` 长时间无响应**

180s 超时后会自动回 error envelope · 看 backend 终端日志关键字 `spawn_subagent inner runner`。

---

## License

MIT. 见 [LICENSE](LICENSE)。

**品牌说明:** `allhands` 是项目代号,`allhands.dev` 已被 All Hands AI 占用。对外发布前会更名。
