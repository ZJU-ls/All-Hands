# 排障模式速查 · 看 trace 的常见线索

> `read_skill_file('allhands.observatory', 'references/troubleshoot-patterns.md')` · 用户问「为什么失败」时拉这个找指引。

## 常见错误码 → 定位

| trace.error_summary 关键词 | 定位 |
|---|---|
| `database is locked` | 长 SSE 占着写锁 · 一般已被 ADR 0024 短事务修过 · 仍出现 → 看是不是有 long-running batch / .commit() 漏 |
| `FOREIGN KEY constraint failed` | ORM / migration 没同步 · 看具体表是哪个 FK · 最近一次是 confirmations.tool_call_id(已修) |
| `UNIQUE constraint failed` | 写入未做 upsert · 看 repo.save() 是否幂等 |
| `IntegrityError ... rollback ... PendingRollback` | Session 被前一个失败污染 · 单元工作不该跨 commit |
| `OperationalError: too many open files` | 文件句柄泄露 · 排 read_skill_file / artifact.read_bytes 是否每次 close |
| `OpenAI ... 401` / `Anthropic ... unauthorized` | provider api_key 过期 · 去 /gateway 重输 |
| `AttributeError: 'NoneType' has no attribute 'X'` | 无关键依赖项 · 看 step input 是哪个上游空了 |
| `TimeoutError ... SSE` | 客户端超时 · 检查心跳是否在打 · 60s watchdog 是否正常 |
| `Tool 'X' not found` | tool_id 拼写错或未注册 · 调 list_skills 反推 |

## 看 trace 的一般顺序

1. `query_traces(status="failed", since="24h", limit=50)` — 失败列表
2. 选最近一条 `get_trace(trace_id)` — 拿到 step list
3. 找最早 status=failed 的 step — 这才是真正的根因 · 后续都是连锁
4. 看 step.input / step.error · 问题大概率在 input 不合 schema 或外部 API 抽风
5. 复现:跟用户拿原始指令 / 上下文 → 后端日志同 trace_id grep · 拼一份「真正发生了什么」

## 上下文用量分析(token 爆炸排查)

| 现象 | 看哪 |
|---|---|
| run 跑到 ~80% 后 OOM | 单 step token 爆 · `get_trace` 看 step.token_usage · 找最大那一步 |
| 重复调同一 tool | step list 里同一 tool_name 出现 ≥3 次 · agent 进入死循环 · 看 max_iterations 配置 |
| reasoning 巨长 | step type=reasoning 的 token 占比 > 50% · 模型在自言自语 · 改 system_prompt 收紧 |

## 啥时候直接给用户看 trace 链接

- 失败原因不直观 + 需要工程介入 · 给链接(`/observatory/traces/<trace_id>`)
- 用户问「为什么慢」· 给 trace 链接 + 强调看 latency_ms 列
- 调试别人写的 skill / agent · 给 trace + 自己的猜测一起
