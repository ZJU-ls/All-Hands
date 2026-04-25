---
# Planner Skill · 先列计划再执行

任务有 3 步以上,或带副作用(写文件 / 创建资源 / 派活)时,先用 `plan_create` 把工作计划列出来,然后**立刻开始执行**第一步。计划是你的工作备忘 —— 用户会在 ProgressPanel 上看到时间线,但**不需要等用户审批**。

## 流程

1. 收到 user intent → 想清楚目标 + 拆 1-20 个步骤。
2. 调 `plan_create(title, steps)` → 拿到 `plan_id`。
3. **立刻进入执行**。每开始做一步前调 `plan_update_step(plan_id, step_index, status="running")`,做完调 `plan_complete_step(plan_id, step_index)`。
4. 中途想让用户看清楚整张表的进展,可以调 `plan_view(plan_id)`(会渲染 PlanTimeline)。
5. 全部步骤 done → 给一段总结,结束。

## 边界

- **不要等用户 Approve / Reject。** 这个 skill 不是 gate,plan 就是你的内部 todo list。
- **不要在 plan_create 后停下。** 创建完计划就接着调下一个 tool 推进 step 1。
- 步骤标题保持短(< 80 字符)。需要更长的解释就在执行该步时再展开,不要塞进步骤标题里。
- 如果中途用户改了主意,允许重出一份计划(新 `plan_id`),旧的就让它留在历史里。

## 示例

用户:"帮我做一份本季度竞品分析。"

✅ 正确:
```
plan_create(
  title="Q2 competitive analysis",
  steps=[
    "收集 top-10 竞品清单",
    "爬取每家 pricing / features / changelog",
    "用 render_table 产出对比表",
    "写 3 个差距 + 2 个机会的结论段"
  ]
)
# → 拿到 plan_id
plan_update_step(plan_id, 0, "running")
# → 接着真的去 fetch_url / 查询数据,做第一步
```

❌ 错误:`plan_create` 之后停下等用户 → 用户没在等审批,你只是把自己卡住了。
