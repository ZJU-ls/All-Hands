# 触发器管理 · 工作流

## 何时调用

用户提到「定时」「自动跑」「每天 / 每周 / 每月」「事件触发」「webhook 触发」 → 先 `list_triggers` 看现有,再决定 create / update / toggle。

## 典型工作流

1. **盘点** — `list_triggers()` 看已有触发器,避免重复
2. **创建** — `create_trigger(name, kind, schedule, action, target_employee_id)`
   - kind=cron · schedule 用标准 cron 表达式(`0 9 * * MON-FRI`)
   - kind=event · schedule 留空,用 payload 触发
   - action 必填,描述「触发了要做什么」 — 通常是「dispatch 给某员工 + 简短任务描述」
3. **启用** — 创建后默认 `enabled=false` · 必须 `toggle_trigger(id, enabled=true)` 才会真跑(常见坑)
4. **测一下** — 不想等到下次 cron · `fire_trigger_now(id)` 立即触发一次,看 fire 结果
5. **查执行历史** — `list_trigger_fires(trigger_id)` 看过去 N 次的成功 / 失败

## 常见坑

- 创建后忘 toggle → 用户以为创建了实际没跑
- cron 表达式时区是服务器时区(UTC) · 跨时区任务要算清楚
- 修改 schedule 后只在下个周期生效 · 想立即看效果用 fire_trigger_now
