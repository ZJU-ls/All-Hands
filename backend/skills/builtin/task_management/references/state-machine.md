# Task 状态机 · 状态转换图 + 操作映射

> `read_skill_file('allhands.task_management', 'references/state-machine.md')` · 决定要不要 cancel / approve / answer 时拉这个。

## 状态图

```
              ┌────────┐
       ┌──────│ created│
       │      └────┬───┘
       │           │ 自动启动
       ▼           ▼
   ┌─────────┐  ┌─────────┐
   │ canceled│  │ running │◀─────────┐
   └─────────┘  └────┬────┘          │
                     │               │
        ┌────────────┼────────────┐  │
        ▼            ▼            ▼  │
  awaiting_input awaiting_appr   ...│恢复
        │            │               │
   answer_input  approve(decision)   │
        │            │               │
        └────────────┴───────────────┘
                     │
                ┌────▼────┐
                │ done /  │
                │ failed  │
                └─────────┘
```

## 操作 → 哪个状态可以做

| 操作 | 允许状态 | 不允许时报 |
|---|---|---|
| `tasks.cancel(id, reason)` | created / running / awaiting_approval | "task in awaiting_user_input · answer first" |
| `tasks.approve(id, decision)` | awaiting_approval | "task not awaiting approval" |
| `tasks.answer_input(id, answers)` | awaiting_user_input | "task not awaiting user input" |
| `tasks.add_artifact(id, art_id, role)` | 任何非 canceled / failed | "task closed · cannot mutate" |
| `tasks.get(id)` | 任何 | — 总能查 |

## 状态语义

| 状态 | 谁在等 | 怎么解 |
|---|---|---|
| `created` | 调度系统(short) | 等 1-2 秒就会变 running |
| `running` | agent 正在做 | 看 task.current_step 知进度 |
| `awaiting_user_input` | 用户回答 ask_user_question | `answer_input(answers={...})` |
| `awaiting_approval` | 用户批准/拒绝(WRITE 工具) | `approve(decision="approve" 或 "reject")` |
| `done` | 终态 | 只读;可挂 artifact |
| `failed` | 终态(异常) | 只读;看 task.error |
| `canceled` | 终态(用户取消) | 只读;有 cancel_reason |

## 常见交互(原话 → 操作)

| 用户说 | 操作 |
|---|---|
| 「那个任务跑完了吗?」 | `tasks.get(id)` 看 status · 是 done 给摘要,running 给 current_step |
| 「取消那个长任务」 | 先 `tasks.get` 确认状态 · running / created 直接 cancel · awaiting_input 报错则提示用户先回答 |
| 「我同意 / 拒绝」 | `approve(decision="approve" 或 "reject", reason="...")` · 必传 reason |
| 「我刚才那个问题的答案是 X」 | `answer_input(task_id, answers={"<question_key>": "X"})` |
| 「把这份报告挂到那个任务上」 | `add_artifact(task_id, artifact_id, role="output")` |

## 失败回路

`failed` 状态的任务有 `task.error` + `task.last_step` · 用户可以:
1. 看完原因
2. **复制原指令重发**(目前没有 "retry" 工具 · 创建新任务覆盖)
3. 老任务保持 failed · 历史可查
