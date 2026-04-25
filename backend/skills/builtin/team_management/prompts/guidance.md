# 团队管理 · allhands.team_management

## 何时调用

用户说「新建员工」「招个 X 角色」「改员工」「删员工」「派 X 给 Y」「这个员工配置预览一下」 → 这套技能。

## 工作流

1. **建员工前先预览** — `preview_employee_composition(preset, custom_tool_ids, custom_skill_ids, ...)` 让用户看到最终 tool 池 + max_iterations + 合成 prompt,再决定建不建
2. **创建** — `create_employee(name, preset?, custom_tool_ids?, custom_skill_ids?, model_ref?, system_prompt?)`
3. **改** — `update_employee(employee_id, name?, ...)` · 部分字段更新
4. **删** — `delete_employee(employee_id)` · IRREVERSIBLE · 自动走 confirmation gate
5. **派任务** — `dispatch_employee(employee_id, task, context_refs?, timeout_seconds?)`

## 工具地图

| 想做什么 | 用 |
|---|---|
| 新建员工 | `create_employee` |
| 修改员工 | `update_employee` |
| 删员工 | `delete_employee`(IRREVERSIBLE) |
| 装配前预览 | `preview_employee_composition` |
| 派单一任务 | `dispatch_employee` |

## 调用示例

```
# 「招一个金融分析师 · 用 Bailian Qwen3 · 挂 stock 系列 skill」
preview_employee_composition(
  preset="generic",
  custom_skill_ids=["allhands.skills.stock_assistant", "allhands.market_data", "allhands.artifacts"],
  custom_tool_ids=[],
  model_ref="bailian/qwen3-plus"
)
# 用户看预览后说 「OK」
create_employee(
  name="金融分析师",
  preset="generic",
  custom_skill_ids=["allhands.skills.stock_assistant", "allhands.market_data", "allhands.artifacts"],
  model_ref="bailian/qwen3-plus"
)

# 派任务
dispatch_employee(
  employee_id="emp_finance",
  task="分析 AAPL 最近一周走势 · 给我一份 markdown 简报",
  timeout_seconds=300
)
```

## 常见坑

- **dispatch 子 agent 看不到对话** — `task` / `context_refs` 必须自包含目标 + 约束 + 样本 + 成功标准
- **一个员工塞 10 个不相关工具** — 工具数 > 模型有效注意力时模型乱选 · 用 skill 分组
- **preset="generic" 容易**忘** model_ref** — 不传会用全局默认 · 跨语种 / 跨能力的员工可能不匹配
- **改了 system_prompt 后 max_iterations 也要看一眼** — 复杂任务需要更多轮

## 失败时怎么办

| 现象 | 做什么 |
|---|---|
| `create_employee` 报 "name already exists" | 让用户改名 / 或先 delete 同名员工 |
| `dispatch_employee` 报 "employee not found" | `list_employees` 拿正确 id · 注意 status 必须是 published |
| `dispatch_employee` 返回 timeout 但任务没完成 | 加大 timeout_seconds · 或拆成多个 dispatch |
| `preview_employee_composition` 报 skill_id 无效 | `list_skills` 看 builtin / installed 现状 · 用 id 而非 name 引用 |
