# ADR 0006 · SSE + asyncio(方案 C)

**日期:** 2026-04-17  **状态:** Accepted

## Context

Agent 执行是长任务(几秒到几分钟),传统 HTTP request/response 模型不合适。候选:

- **A. 同步 HTTP** — 请求期内跑完,超时风险高
- **B. Queue + Worker + WebSocket** — 可断点续跑,但要 Redis/Celery,v0 太重
- **C. SSE 流 + in-process asyncio** — 单进程 async,流式回推

## Decision

**采用 C。**

- FastAPI 接收对话请求,开 asyncio task 执行 LangGraph
- 响应 `text/event-stream`,流式推送 token / tool_call / render / done
- LangGraph `AsyncSqliteSaver` 提供 checkpoint,中断可恢复
- uvicorn `workers=1`(SQLite 限制),asyncio 处理并发

## Rationale

- **最简**:无 queue、无 worker、无 broker
- **LangGraph 原生 async**:所有 API 都是 async 友好
- **Checkpoint 自带断点续跑**:不必自己做状态机
- **SSE 对浏览器兼容最好**:无需 WebSocket 握手,简单
- **升级路径清晰**:v1 加触发器时,APScheduler 独立进程通过 HTTP 调 backend API,不需要重构

## Consequences

- **关浏览器 = 任务仍在后台跑**,重新打开需要从 checkpoint 恢复(UI 要支持 resume)
- **单 worker 限制**:CPU 密集场景受限,但 MVP 是 LLM 调用 I/O-bound,影响小
- **SSE 单向**:客户端 → 服务端用单独 REST endpoint(`POST /confirmations/{id}/resolve`)

## Alternatives considered

- **A 同步 HTTP** — 否:长任务超时
- **B Queue + Worker** — 否:v0 过度工程
- **WebSocket** — 否:SSE 足够,双向复杂度不必要
