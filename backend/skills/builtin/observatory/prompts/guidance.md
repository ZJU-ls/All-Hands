# 运行观测 · 工作流

## 何时调用

用户问「这次跑得怎么样」「trace 在哪」「上次失败的那个 run」「langfuse 连上了吗」 → 这套技能。

## 典型工作流

1. **健康检查** — `observatory.get_status()` · 看 langfuse 是否 connected · 总 trace 数 / 失败率 / 最近 host
2. **如果 langfuse 未连**:`observatory.bootstrap_now()` 重连一次 · 再看 status
3. **批量查 trace**:`observatory.query_traces(employee_id?, status="ok|failed", since="24h", limit=50)` · 返回 trace 列表
4. **看一条详情**:`observatory.get_trace(trace_id)` · 完整 step / token / 耗时 / 错误栈

## 常见坑

- langfuse 没连上 ≠ trace 丢了 · 本地 events 表仍有 run.* 事件 · UI 自动 fallback
- trace_id 不是 conversation_id · 一次对话有多个 turn · 每 turn 有 1 trace
- since 支持 `1h / 24h / 7d` · 不写默认 24h
