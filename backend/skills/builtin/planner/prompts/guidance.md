---
# Planner Skill · 先列计划再执行

任务有 3 步以上,或带副作用(写文件 / 创建资源 / 派活)时,先用 `plan_create` 把工作计划列出来,然后**立刻开始执行**第一步。计划是你的工作备忘 —— 用户会在 ProgressPanel 上看到时间线,但**不需要等用户审批**。

## 硬规则 · 必须照做

1. **行动 > 描述。** 不要写"接下来我会用 spawn_subagent 拆解 ..." / "我准备调用 plan_update_step ..." 这类**未来时陈述句** —— **直接调那个 tool**。叙述等于停摆,用户会看到你卡住。
2. **每一轮回复都必须以 tool_call 收尾**(直到全部步骤 done 才能纯文本结束)。如果你想到的下一动作是"做某事",那就把它变成 tool_call,不是变成文字。
3. **plan_create 之后,同一轮里直接接着调下一个 tool**(`plan_update_step` 把第 0 步标 running,或者直接调真正干活的 tool)。中间不要停下解释计划长什么样 —— ProgressPanel 已经在帮你展示了。
4. **被用户催促"做完 / 继续 / 整体走完"时**:不要再总结你刚才做了什么、不要再描述接下来要做什么 —— 直接调下一个 tool 推进未完成的 step。

## 流程

1. 收到 user intent → 想清楚目标 + 拆 1-20 个步骤。
2. 调 `plan_create(title, steps)` → 拿到 `plan_id`,**同一轮**接着 `plan_update_step(plan_id, 0, "running")` + 真正干第一步的 tool。
3. 每完成一步调 `plan_complete_step(plan_id, i)`,**同一轮**接着 `plan_update_step(plan_id, i+1, "running")` + 干下一步的 tool。
4. 全部步骤 done → 才能给一段简短总结,结束本轮。
5. 中途如果遇到无法绕过的卡点(缺权限 / 缺 tool / 缺信息),用 `plan_update_step(..., "failed", note="原因")` 标失败,**再**用文字向用户解释要什么。

## 边界

- **不要等用户 Approve / Reject。** 这个 skill 不是 gate,plan 就是你的内部 todo list。
- **不要描绘空气计划。** 例:"子任务 A: 请搜索 GitHub Copilot ..." 这种"我打算分派"的空文字,无意义 —— 真要派活就当场 `spawn_subagent`,不派就不写。
- 步骤标题保持短(< 80 字符)。

## 示例

用户:"帮我做一份本季度竞品分析。"

✅ 正确(一轮里连着调多个 tool):
```
plan_create(title="Q2 竞品分析", steps=["收集竞品", "爬取页面", "做对比表", "写结论"])
plan_update_step(plan_id, 0, "running")
fetch_url(url="https://crm.internal/competitors")
```

❌ 错误(纯叙述,没有 tool):
```
我已经为您创建了一个 5 步计划。接下来我会:
1. 收集竞品清单
2. 爬取每家页面
...
```
↑ 用户看完这段不会按按钮,他在等你做。这种回复 = 卡住。
