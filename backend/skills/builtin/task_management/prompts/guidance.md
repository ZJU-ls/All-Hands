# 任务管理 · 工作流

## 何时调用

用户说「这个任务跑到哪了」「取消那个任务」「批准 / 验收」「这个任务挂上 X 制品」 → 先 `tasks.list(status=...)` 找到,再 get 看详情。

## 典型工作流

1. **盘点** — `tasks.list(workspace_id?, statuses=["running","awaiting_input"])` · 默认按更新时间倒序
2. **细看** — `tasks.get(task_id)` · 得到任务标题 / 当前 step / 等待状态 / 已挂的 artifact ids
3. **取消** — `tasks.cancel(task_id, reason)` · 任务必须不在 awaiting_user_input 状态
4. **批** — `tasks.approve(task_id, decision="approve" | "reject", reason)` · 用于 awaiting_approval 阻塞的任务
5. **回答输入** — `tasks.answer_input(task_id, answers={...})` · 用于 awaiting_user_input 阻塞,answers 是用户对 ask_user_question 的回复
6. **挂制品** — `tasks.add_artifact(task_id, artifact_id, role="output")` · 把 agent 产的文件 / 报告关联到任务

## 常见坑

- 任务的 status 是事件投影 · 显示 stale 时刷一下 list 即可
- approve / answer_input 调错任务 ID 没回滚 · 调前 get 一次确认
- 一个任务可挂多个 artifact · role 字段区分:input / output / draft
