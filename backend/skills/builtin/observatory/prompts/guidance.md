# 运行观测 · 工作流

## 何时调用

用户问「这次跑得怎么样」「trace 在哪」「上次失败的那个 run」「langfuse 连上了吗」 → 这套技能。

## 典型工作流

1. **健康检查** — `observatory.get_status()` · 看 langfuse 是否 connected · 总 trace 数 / 失败率 / 最近 host · 如果未连提示用户去 /gateway 检查 LANGFUSE_HOST + secret
2. **批量查 trace**:`observatory.query_traces(employee_id?, status="ok|failed", since="24h", limit=50)` · 返回 trace 列表
3. **看一条详情**:`observatory.get_trace(trace_id)` · 完整 step / token / 耗时 / 错误栈

## 调用示例

```
# 「最近 24h 的失败 run 都是哪些?」
observatory.query_traces(status="failed", since="24h", limit=20)
# → 列表 with trace_id / employee_id / error_summary

# 看一条具体的
observatory.get_trace(trace_id="trace_abc123")
# → step list / 每步 token 用量 / latency / error stack

# 检查后端追踪状态
observatory.get_status()
# 若 connected=false · 提示:「langfuse 未连接 · 去 /gateway 检查 LANGFUSE_HOST + LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY 后重启后端」
```

## 常见坑

- langfuse 没连上 ≠ trace 丢了 · 本地 events 表仍有 run.* 事件 · UI 自动 fallback
- `trace_id` 不是 `conversation_id` · 一次对话有多个 turn · 每 turn 有 1 trace
- `since` 支持 `1h / 24h / 7d` · 不写默认 24h
- `query_traces` 默认按 started_at 倒序 · 找老 run 要拉 limit=200 + 自己翻

## 失败时怎么办

| 现象 | 做什么 |
|---|---|
| `get_status` 返回 connected=false | 引导用户改 .env(LANGFUSE_*)+ 重启后端;期间 trace 仍写本地 |
| `query_traces` 返回空 | 时间窗太窄 · 拉到 7d · 或检查 employee_id 拼写 |
| `get_trace` 拿到的 step 没有 error 详情 | 这条 run 当时未启用 trace · 切到本地 events 表查(由 cockpit_admin 的 get_workspace_summary) |
