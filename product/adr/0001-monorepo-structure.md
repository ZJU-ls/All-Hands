# ADR 0001 · Monorepo 结构

**日期:** 2026-04-17  **状态:** Accepted

## Context

allhands 包含 Python backend + Next.js frontend,两者需要共享类型协议(SSE envelope、domain models 的 TS 镜像),并通过 docker-compose 一起交付。备选:两个独立仓库或一个 monorepo。

## Decision

**单一 monorepo。** 布局:

```
allhands/
├── product/               # 产品与架构文档(单一真相源)
├── plans/                 # implementation plans
├── backend/               # Python FastAPI
├── web/                   # Next.js
├── scripts/
├── docker-compose.yml
├── CLAUDE.md              # 开发契约
└── .claude/               # 项目级 skill + hooks
```

## Rationale

- **类型同步**:SSE event、Render Payload schema 在同一 PR 里改前后端,避免双仓漂移
- **原子化开发**:一个 feature = 一个 PR 跨 backend/web,review 完整
- **交付形态一致**:docker-compose 根就在仓库根,一键起
- **开源分发**:clone 一个仓库就能跑,降低新用户门槛

## Consequences

- 前后端不同语言,CI 需要分别配置(Python + Node)
- 仓库体积增长受 node_modules 影响 → `.gitignore` 严格管理
- 未来切分(如 SDK 独立分发)需要 git subtree / filter-repo,可接受

## Alternatives considered

- **两个独立仓库** — 否:类型同步成本、原子 PR 丢失
- **pnpm workspaces + uv workspaces 双栈** — 过度工程,v0 不需要
