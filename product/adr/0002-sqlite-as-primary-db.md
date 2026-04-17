# ADR 0002 · SQLite 作为主数据库

**日期:** 2026-04-17  **状态:** Accepted

## Context

开源自部署产品需要**低运维启动**。Dify 的体验痛点之一就是依赖齐全时 docker-compose 起来很慢。用户要求 SQLite。

## Decision

- **主应用数据库:SQLite**(WAL 模式),路径 `data/app.db`,挂 docker volume
- **LangGraph checkpointer:SQLite**(`AsyncSqliteSaver`),同库不同表前缀
- **LangFuse 独立栈**(它自带 postgres + clickhouse + redis + minio,不与主应用共享)
- **SQLAlchemy 连接串**:`DATABASE_URL=sqlite+aiosqlite:///./data/app.db`,配置化
- 保留切 Postgres 的口子:仅需改 `DATABASE_URL`,ORM/Alembic 已兼容

## Rationale

- **零额外服务**:不用起 postgres 容器,docker compose up 更快
- **备份 = 复制文件**:运维心智极简
- **LangGraph 原生支持**:`AsyncSqliteSaver` 官方维护
- **v0 并发量够**:自部署单机单用户 / 小团队,WAL 足够

## Consequences(及应对)

| 风险 | 应对 |
|---|---|
| 多进程写冲突 | uvicorn `workers=1` + asyncio 并发 |
| 高并发 Supervisor 派生 | WAL + 事务粒度细化;文档标注"已知限制"|
| 数据量大(>1GB)性能退化 | v1 前不会到;v1+ 提供 Postgres 切换指南 |
| 备份无热快照 | 文档建议停机快照或 `VACUUM INTO` |

## Alternatives considered

- **Postgres 独立容器** — 额外依赖,对自部署体验不友好
- **双模式(dev SQLite + prod Postgres)** — 环境分裂,bug 难复现
