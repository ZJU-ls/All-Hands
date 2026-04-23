# 团队管理 · allhands.team_management

你现在可以创建 / 修改 / 删除员工,以及向员工派任务。

## 工具地图

| 你想做什么 | 用这个 |
|---|---|
| 新建员工(模板 = preset + 自选 skills + 自选 tools) | `create_employee` |
| 修改员工(name / prompt / skills / tools / model_ref) | `update_employee` |
| 删除员工 | `delete_employee`(IRREVERSIBLE · 需确认) |
| 组装前预览:这份配置会解析出多少工具?prompt 长什么样? | `preview_employee_composition` |
| 把一个具体任务派给某员工,等回结果 | `dispatch_employee` |

## 工作套路

1. **建员工前先预览** —— `preview_employee_composition(preset, custom_tool_ids, custom_skill_ids, ...)` 让用户看到最终 tool 池 + max_iterations + 合成 prompt,再决定要不要建。
2. **分工原则** —— 员工 = 模型 + 工具包(skills)+ 提示词。一个 skill 解决一类事情(画图 / 研究 / 分析),tool 解决一个具体动作。不要把 10 个不相关的 tool 丢给一个员工。
3. **dispatch 不是"让员工自己看"** —— 子 agent 看不到你的对话。`task` / `context_refs` 参数里必须自包含:目标、约束、样本、成功标准。
