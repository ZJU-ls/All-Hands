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

## 调用示例

```
# 「跑了 3 小时的那个 spec 跑完了吗?」
tasks.list(statuses=["running", "awaiting_input", "awaiting_approval"], limit=20)
# → 找到 task_id
tasks.get(task_id)   # 看 status 是 awaiting_user_input + 待回答的问题

# 用户回答了 → 把答案推回
tasks.answer_input(
  task_id=task_id,
  answers={"approval_threshold": "85%", "include_charts": True}
)
# 任务恢复执行

# 完成后挂报告
tasks.add_artifact(task_id=task_id, artifact_id=artifact_id, role="output")
```

## 常见坑

- 任务的 status 是事件投影 · 显示 stale 时刷一下 `tasks.list` 即可
- `approve` / `answer_input` 调错任务 ID 没回滚 · 调前 `tasks.get` 一次确认
- 一个任务可挂多个 artifact · role 字段区分:input / output / draft
- `cancel` 一个 awaiting_user_input 的任务会失败 · 先用 `answer_input` 给 dummy answer 让任务前进,再 cancel

## 失败时怎么办

| 现象 | 做什么 |
|---|---|
| `tasks.get` 返回 404 | task_id 错 · 用 list 重新找 · 注意 task_id 不是 run_id |
| `approve` 报 "task not awaiting approval" | 状态不对 · `tasks.get` 确认 status · 大概率任务已自己往前走了 |
| `answer_input` 报 "answers schema mismatch" | 用户的回答字段不全 · 拿 task.required_input.questions 对照 |
