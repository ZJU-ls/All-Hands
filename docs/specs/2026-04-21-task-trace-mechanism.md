# Task Trace Mechanism · 任务可追溯契约

**Date:** 2026-04-21
**Status:** Approved → In-Progress
**Scope:** v0 demo-ready(快照版;live tailing 列作 Follow-up spec)

---

## 1. Context

今天状况:

- Task → Run 是一对多,已在 `0011_add_tasks` 里固化(`tasks.run_ids: JSON 数组`)
- Run 的 reasoning / tool_call / final answer 本来就落在 `messages` 表里,`MessageBubble` 的 `ReasoningBlock` / `ToolCallCard` / `AgentMarkdown` 已经在 chat 面板渲染这些字段
- `events` 表用 `run.started` / `run.updated` / `run.finished` 留时间线和 tokens 汇总
- 观测入口只有 `/observatory`(50 条摘要表)和 `/traces`(带一个 Drawer 但没细节),点击任何一条 run 都**看不到它做了什么**
- `/tasks/[id]` 把 `run_ids` 渲染成裸文本,**点不开**
- cockpit ActivityFeed、triggers 详情、channels 消息列表里 run_id / task_id 散落在多处,没有统一"跳转到 trace"的动作

用户需求:「点击任何一个任务/run → 看到它完整的 trace(reasoning · tool · answer)」。

## 2. Decision

采用混合入口(C 方案):

1. **一个核心展示组件** `<RunTracePanel>`(纯展示)
2. **两个壳**:
   - **Drawer** — URL 同步 `?trace=<run_id>`,任意列表点击从右侧滑出
   - **标准页** `/runs/[run_id]` — 同 panel 全屏版,用于分享 / 深度阅读
3. **任务详情 `/tasks/[id]`** 内嵌 RunTracePanel per run(不走 chip;这页就是给看 trace 用的)
4. **其他列表** 用 `<TraceChip>` 微徽标打点

## 3. Data contract

### 3.1 `RunDetailDto`(后端 → 前端)

```ts
type Turn =
  | { kind: "user_input";  content: string; ts: string }
  | { kind: "thinking";    content: string; ts: string }
  | {
      kind: "tool_call";
      tool_call_id: string;
      name: string;
      args: unknown;            // JSON-parsed
      result?: unknown;         // 返回值(JSON 或 string)
      error?: string;           // 工具 raise 的 error
      ts_called: string;
      ts_returned?: string;
    }
  | { kind: "message"; content: string; ts: string };  // agent 最终回答

interface RunDetailDto {
  run_id: string;
  task_id: string | null;
  conversation_id: string;
  employee_id: string;
  employee_name: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  started_at: string;
  finished_at: string | null;
  duration_s: number | null;
  tokens: { prompt: number; completion: number; total: number };
  error: { message: string; kind: string } | null;
  turns: Turn[];  // 按时序升序
}
```

### 3.2 Turn 重建规则

来源 **`messages` 表,按 `run_id` 过滤,`created_at` 升序**。

- `role=user` 首条 → `user_input`
- `role=assistant` 且有 `reasoning` 字段 → 先吐 `thinking`(如果有内容)
- `role=assistant` 且有 `tool_calls[]` → 每个 tool_call 吐一条 `tool_call`(此时 `result` 先为空)
- `role=tool` 消息 → 找到对应 `tool_call_id` 的 tool_call,回填 `result` / `error` / `ts_returned`
- `role=assistant` 且有 `content` 且无 tool_calls → `message`(final answer)

`events` 表补:`started_at` / `finished_at` / `tokens` / `status` / `error`。

**保底**:任何 message 解析不出来就退化为 `message` kind,保留 content,永不丢数据。

## 4. Backend

### 4.1 新增端点

`GET /api/observatory/runs/{run_id}` → `RunDetailDto`

- 404 如果 `run_id` 在 `messages` 和 `events` 里都查不到
- 走现有 `ObservatoryService`(不新增 service 类)

### 4.2 文件

- `backend/src/allhands/core/observability.py`:新增 `Turn` / `RunDetail` dataclass
- `backend/src/allhands/services/observatory_service.py`:新增 `get_run_detail(run_id) -> RunDetail | None`
- `backend/src/allhands/api/protocol.py`:`TurnDto` / `RunDetailDto` Pydantic
- `backend/src/allhands/api/routers/observatory.py`:`@router.get("/runs/{run_id}")`
- `backend/tests/unit/test_observatory_run_detail.py`:turn 重建逻辑单测
- `backend/tests/integration/test_observatory_run_detail_api.py`:HTTP 契约测

## 5. Frontend

### 5.1 新组件

```
web/components/runs/
  RunTracePanel.tsx       — 核心;props: { runId } | { run: RunDetailDto }
  RunHeader.tsx           — status/employee/duration/tokens
  RunTurnList.tsx         — 循环 Turn[] → 子组件
  RunError.tsx            — failed 时的错误块
  RunTraceDrawer.tsx      — 读 ?trace=,渲染 RunTracePanel
  TraceChip.tsx           — 可点徽标;router.replace(+?trace=...)
```

### 5.2 复用(禁止重写)

- `ReasoningBlock`(`components/chat/MessageBubble.tsx`)
- `ToolCallCard`(`components/chat/ToolCallCard.tsx`)
- `AgentMarkdown`(`components/chat/AgentMarkdown.tsx`)

### 5.3 Lib

- `web/lib/observatory-api.ts`:新增 `fetchRunDetail(runId)` + `RunDetailDto` / `TurnDto` 类型

### 5.4 新路由

- `web/app/runs/[run_id]/page.tsx`:`<AppShell title={`trace · ${id.slice(0,8)}`}><RunTracePanel runId={id} /></AppShell>`

### 5.5 URL 合约

- Drawer 读 `?trace=<run_id>`
- 点 `<TraceChip>` → `router.replace(pathname + ?trace=<id>)`(保留原 query)
- Drawer 关闭 / ESC → 去掉 `?trace=` 同时保留其他 query
- 刷新页面 drawer 自动重开

## 6. 页面集成清单

| 页面 | 处理 |
|---|---|
| `/tasks/[id]` | 运行区块改为 `run_ids.map(id => <RunTracePanel runId={id} />)`,直接 inline |
| `/tasks` | 每行 status 旁放一枚 `<TraceChip runId={primary_run_id}/>`(拿 `run_ids[0]`) |
| `/triggers/[id]` | fires 列表的 `run_id` 链改为 `<TraceChip>` |
| `/cockpit` ActiveRunsList | 每行加 `<TraceChip>`(替代目前指向 `/chat` 的跳转,保留 chat 跳转为次要入口) |
| `/observatory` | trace 表每行整行 onClick 开 drawer |
| `/traces` | 同上,Drawer 替代现有 TraceDetailDrawer(旧的删掉) |
| `/channels/[id]` | agent 消息工具栏放 `<TraceChip>` |
| Chat `<MessageBubble>`(assistant) | 时间戳旁 `<TraceChip>`,利用 message 已有 `run_id` |

## 7. 状态机 / UX

- 加载中:`<LoadingState title="加载 trace" variant="skeleton" />`
- 拉不到:`<ErrorState title="trace 取不到" detail={err}>`
- running:header 显示黄色状态灯 + 一行提示"运行中,刷新查看最新轮次";turns 渲染截止目前的
- succeeded / failed / cancelled:status 灯对应色

## 8. v0 范围切口

- **不做 live tailing**。drawer / 专页是"打开时刻快照",不订阅 SSE 追加 turn
- **不做 export**。没有"下载 trace 为 JSON"按钮(未来 spec)
- **不做 diff**。不跨 run 比较(未来 spec)
- **不做 search**。turn 内文本搜索留给浏览器 Cmd+F

## 9. 测试策略

### 9.1 后端

- `test_observatory_run_detail.py`(单元):
  - 空 messages → 空 turns
  - user + assistant(无 tool) → `[user_input, message]`
  - assistant 带 reasoning → `[user_input, thinking, message]`
  - assistant 带 tool_call + 对应 tool result → `[..., tool_call(含 result), ...]`
  - tool_call 没有后续 result → `tool_call.result === None`
  - run_id 未知 → `None`
- `test_observatory_run_detail_api.py`(集成):
  - `GET /api/observatory/runs/{existing}` → 200 + schema
  - `GET /api/observatory/runs/unknown` → 404

### 9.2 前端

- `RunTracePanel.test.tsx`:Loading / Error / 空 turns / 每种 Turn kind 渲染出相应子组件
- `TraceChip.test.tsx`:点击调 router.replace,保留其他 query
- `RunTraceDrawer.test.tsx`:`?trace=<id>` 打开,关闭移除 query
- `/runs/[run_id]` smoke:mount 后能看到 RunTracePanel
- **契约回归**:`no-raw-state-literal.test.ts` 需扫描 runs/ 下新文件,应继续绿
- 视觉纪律:`scripts/check.sh § visual discipline` 应继续绿

## 10. 参考源码(ref-src)

本任务无 Agent-core 改动(只加观测端点 + UI),故不对标 Claude Code agent loop。可参考源:

- LangGraph `state.messages` 结构(`ref-src-langgraph/langgraph/graph/state.py`) — 确认 reasoning / tool_call 在 AIMessage 里的字段名约定
- LangFuse `trace.observations` tree(`ref-src-langfuse/web/src/features/traces`) — Turn 渲染顺序的视觉参考

两者本 spec 都不直接引用,列这里让下一版 spec(live tailing + LangFuse 接入)有入口。

## 11. Files touched / created(定位估算)

**新增:**
- `backend/src/allhands/core/observability.py`(+50 行:Turn/RunDetail dataclass)
- `backend/tests/unit/test_observatory_run_detail.py`(+180 行)
- `backend/tests/integration/test_observatory_run_detail_api.py`(+80 行)
- `web/components/runs/RunTracePanel.tsx`(+120 行)
- `web/components/runs/RunHeader.tsx`(+60 行)
- `web/components/runs/RunTurnList.tsx`(+100 行)
- `web/components/runs/RunError.tsx`(+30 行)
- `web/components/runs/RunTraceDrawer.tsx`(+80 行)
- `web/components/runs/TraceChip.tsx`(+50 行)
- `web/components/runs/__tests__/RunTracePanel.test.tsx`(+120 行)
- `web/components/runs/__tests__/TraceChip.test.tsx`(+60 行)
- `web/components/runs/__tests__/RunTraceDrawer.test.tsx`(+80 行)
- `web/app/runs/[run_id]/page.tsx`(+40 行)

**改动:**
- `backend/src/allhands/services/observatory_service.py`(+ `get_run_detail`,~80 行)
- `backend/src/allhands/api/protocol.py`(+ `TurnDto` / `RunDetailDto`,~40 行)
- `backend/src/allhands/api/routers/observatory.py`(+ `/runs/{id}`,~30 行)
- `web/lib/observatory-api.ts`(+ `fetchRunDetail` + DTO,~30 行)
- `web/components/shell/AppShell.tsx`(挂 `<RunTraceDrawer>`,~5 行)
- `web/app/tasks/[id]/page.tsx`(inline 展开 runs,~30 行)
- `web/app/tasks/page.tsx`(chip 打点,~15 行)
- `web/app/triggers/[id]/page.tsx`(chip 替换,~10 行)
- `web/components/cockpit/ActiveRunsList.tsx`(chip,~15 行)
- `web/app/observatory/page.tsx`(行点击,~10 行)
- `web/app/traces/page.tsx`(替掉旧 Drawer,~40 行)
- `web/app/channels/[id]/page.tsx`(chip,~10 行)
- `web/components/chat/MessageBubble.tsx`(assistant 气泡 chip,~10 行)

**预估总行:≈ 1100 行(含测试)**

## 12. Definition of Done

- [ ] `GET /api/observatory/runs/{id}` 返回 schema 正确(契约测试绿)
- [ ] `/runs/[id]` 能打开任一已完成 run 的完整 trace
- [ ] 任意列表页 `<TraceChip>` 点击 → Drawer 滑出展示完整 trace,URL 同步
- [ ] `/tasks/[id]` 每个 run 都 inline 展开
- [ ] Seed 数据:至少一条已跑完的 task 带 ≥ 1 run,含 reasoning + tool_call + message 三类 turn(借 walkthrough W3 的既有 seed)
- [ ] `./scripts/check.sh` 全绿(backend pytest + web vitest + 视觉纪律 + 分层 + acceptance)
- [ ] 提交 + 推 `ZJU-ls/All-Hands` allhands-dev + fast-forward main

## 13. 执行顺序

1. 后端 DTO + service + route(TDD:先测后码)
2. 前端 lib + RunTracePanel 核心
3. TraceChip + Drawer + /runs/[id] 专页
4. 各页面挂 chip / inline
5. check.sh 修复回归
6. commit + push

## 14. Out of scope(明确不做)

- Live SSE 追加 turn
- Trace diff / export / 搜索
- LangFuse 真实接入(当前仍是本地 events + messages)
- Permission / ACL(v0 单租户)
- 修改 `messages` / `events` 表结构
