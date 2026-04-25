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

## 调用示例

```
# 「每天早上 9 点让 stock-analyst 出一份 daily briefing」
create_trigger(
  name="每日股市简报",
  kind="cron",
  schedule="0 9 * * *",
  action="dispatch_employee(stock-analyst, '产出今日 daily briefing')",
  target_employee_id="emp_stock_analyst"
)
# → 拿到 trigger_id
toggle_trigger(id=trigger_id, enabled=True)   # 别忘了
fire_trigger_now(id=trigger_id)                # 立即跑一次确认行为
list_trigger_fires(trigger_id=trigger_id, limit=5)
```

## 常见坑

- 创建后忘 toggle → 用户以为创建了实际没跑(每次都先 toggle 再退出)
- cron 表达式时区是服务器时区(UTC) · 跨时区任务要算清楚 · 用户说「9 点」要确认是哪个时区
- 修改 schedule 后只在下个周期生效 · 想立即看效果用 `fire_trigger_now`
- 把同一个 dispatch 写成 N 个 trigger · 应该用一个 trigger + payload 区分

## 失败时怎么办

| 现象 | 做什么 |
|---|---|
| `create_trigger` 报 "schedule invalid" | 用 https://crontab.guru 验证表达式后重提 |
| `fire_trigger_now` 返回 `target_unreachable` | 调 `list_employees` 确认 employee_id 仍有效 / 状态=published |
| 触发了但 list_trigger_fires 是空 | 检查 enabled=True · 等 ≥ 5 秒(异步落库) · 还空就看后端 trigger.runtime 日志 |
