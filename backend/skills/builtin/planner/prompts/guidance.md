---
# Planner Skill · `update_plan` 单工具用法

挂上这个 skill 你就有了 **`update_plan`** 工具 —— 一份你自己的 todo list,
用户在 ProgressPanel 上看实时进度,但**不需要审批**。设计参考 Claude Code
的 TodoWrite,Anthropic Agent SDK 的官方契约。

## 何时用

主动激活 `update_plan` 的时机:

1. 任务有 **3 个或更多** 离散步骤
2. 需要规划的非平凡任务(写代码 / 多人协作 / 写报告 / 调研对比 ...)
3. 用户给了多个独立任务(用 1 / 2 / 3 列出来,或 "帮我做 A、B、C")
4. 用户明确让你"做个计划 / 列个 todo / show 你的计划能力"
5. 收到新指令后

## 何时**不用**

- 单步任务("现在几点 / 帮我翻译这句话 / 解释这段代码")
- 1-2 个动作就能搞定的琐事
- 纯对话、问答、解释类回复
- 当审批闸用 —— 它不是,plan 一发出就视为已开始

## 怎么用 · 核心规则

### 1. 全量替换,不是增量

每次 `update_plan` 都发**完整的 todo 列表**。要让第 3 步从 pending 变 in_progress?
把整个列表发一遍,只把第 3 步的 status 改了。**不要发"只改这一项"** —— 没有
这种语义,工具就是替换。

### 2. 三态 + 双字段

每个 todo 必须包含三个字段:

| 字段 | 含义 | 例 |
|---|---|---|
| `content` | 祈使句 · 显示在 pending / completed 状态 | `"Run integration tests"` |
| `activeForm` | 现在进行时 · 显示在 in_progress 状态(spinner 文案) | `"Running integration tests"` |
| `status` | `"pending"` / `"in_progress"` / `"completed"` 三选一 | `"in_progress"` |

UI 会在 in_progress 时优先显示 `activeForm`,你看到 spinner 配 "Running tests"
而不是 "Run tests"。

### 3. **同一时刻最多一个 `in_progress`**

这是硬规则。executor 会拒绝 2 个以上 in_progress 的请求并返回 error。

完成第 N 步切到第 N+1 步时,**在同一次 `update_plan` 调用里**:
- 把第 N 步标 `"completed"`
- 把第 N+1 步标 `"in_progress"`

这一次原子切换,UI 看到的就是平滑的进度推进。

### 4. 完成判据

`status` 改成 `"completed"` 之前必须确认:

- 真的做完了(测试通过 / 文件写了 / 子代理回了)
- 没有未解决的错误
- 不是部分完成

被卡住时**不要**强行 mark completed —— 留 in_progress,加一个 pending todo
描述阻塞,然后告诉用户。

### 5. 状态文字 + tool_call

每轮回复格式:**一两句简短状态文字 + 紧接着的 tool_call**。例:

> "开始第 2 步:启动写作子代理。"
>
> [立刻调 `spawn_subagent(...)` 或 `update_plan(...)`]

不要纯 tool_call 不带任何文字 —— 用户在 chat 里看不到你在干什么。
也不要长篇大论描绘计划 —— 卡片已经在展示了。

## 配套 · `view_plan`

如果对话被压缩、自己忘了走到哪了,调 `view_plan()` 拉一次当前列表。
返回 `{plan_id, title, todos}`。注意:UI 已经在 ProgressPanel 持续展示
最新 plan,**正常情况你不需要调这个**,它是 fallback。

## 完整示例

用户:"帮我做一份 Q2 竞品分析,3 家产品。"

✅ 第一轮回复:
```
"我来安排,先列个 4 步计划,直接开干第一步。"
update_plan(todos=[
  {"content": "Collect 3 competitors info", "activeForm": "Collecting competitor info", "status": "in_progress"},
  {"content": "Crawl pricing / features pages", "activeForm": "Crawling pricing pages", "status": "pending"},
  {"content": "Build comparison table", "activeForm": "Building comparison table", "status": "pending"},
  {"content": "Write conclusions", "activeForm": "Writing conclusions", "status": "pending"}
])
[然后接着调真正干活的 tool,比如 fetch_url 或 spawn_subagent]
```

✅ 完成 step 1,推进 step 2(注意:同一次 update_plan 同时改两步):
```
"第 1 步信息收齐,进入爬取阶段。"
update_plan(todos=[
  {"content": "Collect 3 competitors info", "activeForm": "Collecting competitor info", "status": "completed"},
  {"content": "Crawl pricing / features pages", "activeForm": "Crawling pricing pages", "status": "in_progress"},
  {"content": "Build comparison table", "activeForm": "Building comparison table", "status": "pending"},
  {"content": "Write conclusions", "activeForm": "Writing conclusions", "status": "pending"}
])
[继续调 fetch_url 等工具]
```

❌ 错误 1:只发改动的那一项 —— 工具是全量替换,你会把其他 todo 都丢掉:
```
update_plan(todos=[{"content": "Crawl pages", "activeForm": "Crawling", "status": "in_progress"}])
```

❌ 错误 2:两个 in_progress —— executor 直接拒:
```
update_plan(todos=[
  {... "status": "in_progress"},
  {... "status": "in_progress"},  ← 第二个会让整个调用失败
  ...
])
```

❌ 错误 3:还在做 / 被卡住却 mark completed —— 用户看到"完成"实际没完成,
信任崩。被卡留 in_progress + 加 pending 描述 blocker。

❌ 错误 4:纯叙述,不调 update_plan —— "我会先 ... 然后 ..." 用户在等,
不是看你说。

❌ 错误 5:为单步任务用 update_plan —— "解释这段代码"不需要 plan,直接答。
