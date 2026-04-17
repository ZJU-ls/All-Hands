# allhands

> **One for All** — 一个 Lead Agent 搞定一切。
> 开源自部署的"数字员工组织"平台,对话式操作,Tool First。

**Status:** v0 MVP · 开发中

---

## 核心能力(v0)

- 🧑‍💼 **Lead Agent** — 你的唯一入口。对话式完成员工 CRUD、派遣、观测
- 🔧 **Tool First** — 所有能力皆 Tool(Backend / Render / Meta)
- 🔁 **统一 React Agent** — 所有员工同一架构,区别仅在工具集
- 🔐 **L4 对话 + 护栏** — 敏感操作自动 Confirmation Gate
- 🧩 **MCP 挂载** — stdio / SSE / HTTP 三种 transport
- 🔭 **LangFuse 内嵌** — 全链路可观测,嵌套 trace

---

## 快速开始

**前置:** Docker + Docker Compose, OpenAI-compatible API key

```bash
git clone <this-repo> allhands
cd allhands
cp .env.example .env
# 编辑 .env,填入 OPENAI_API_KEY 等
docker compose up --build
```

启动完成后:

- **Web UI:** http://localhost:3000
- **Backend API:** http://localhost:8000/api/health
- **LangFuse:** http://localhost:3001(首次进入创建账号)

---

## 本地开发(无 Docker)

```bash
# Backend
cd backend
uv sync
uv run alembic upgrade head
uv run uvicorn allhands.main:app --reload

# Frontend (另一个终端)
cd web
pnpm install
pnpm dev

# LangFuse 仍用 docker compose 起(只启 langfuse 相关服务)
docker compose up langfuse-web langfuse-worker langfuse-postgres langfuse-clickhouse langfuse-redis langfuse-minio
```

---

## 文档

| 文档 | 用途 |
|---|---|
| [product/00-north-star.md](product/00-north-star.md) | 产品哲学 + 4 条设计原则 |
| [product/01-prd.md](product/01-prd.md) | PRD |
| [product/02-user-stories.md](product/02-user-stories.md) | 用户故事 + 验收标准 |
| [product/03-visual-design.md](product/03-visual-design.md) | 视觉系统 + design tokens |
| [product/04-architecture.md](product/04-architecture.md) | 10 层技术架构 |
| [product/05-roadmap.md](product/05-roadmap.md) | 版本演进 |
| [product/adr/](product/adr/) | 架构决策记录 |
| [CLAUDE.md](CLAUDE.md) | 开发契约(Claude 会话必读) |

---

## Scripts

```bash
./scripts/check.sh       # 全量 lint + type + test
./scripts/dev.sh         # 启本地开发栈
```

---

## License

MIT. 见 [LICENSE](LICENSE)。

**品牌说明:** `allhands` 是项目代号,`allhands.dev` 已被 All Hands AI 占用。对外发布前会更名。
