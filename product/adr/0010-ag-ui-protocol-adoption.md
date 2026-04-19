# ADR 0010 · 采纳 AG-UI Protocol 作为 SSE streaming 基线

**日期:** 2026-04-19  **状态:** Accepted(实现分阶段落地 · 见 [`docs/specs/2026-04-19-ag-ui-migration.md`](../../docs/specs/2026-04-19-ag-ui-migration.md))

## Context

v0 四条 SSE endpoint 用四套**自己发明**的事件名:

| Endpoint | 事件集 | 示例 |
|---|---|---|
| `POST /api/conversations/{id}/messages` | `token` / `tool_call_start` / `tool_call_end` / `confirm_required` / `confirm_resolved` / `render` / `nested_run_start` / `nested_run_end` / `trace` / `done` / `error` | `event: token\ndata: {"message_id":"…","delta":"he"}` |
| `GET /api/cockpit/stream` | `snapshot` / `activity` / `run_update` / `run_done` / `health` / `kpi` / `heartbeat` / `error` | `event: run_update\ndata: {"id":"…","kind":"run.updated","payload":{…}}` |
| `GET /api/artifacts/stream` | `ready` / `artifact_changed` / `heartbeat` / `error` | `event: artifact_changed\ndata: {"kind":"artifact_changed","payload":{…}}` |
| `POST /api/models/{id}/test/stream` | `meta` / `delta` / `reasoning` / `done` / `error` | `event: delta\ndata: {"text":"…"}` |

前端 `web/lib/stream-client.ts` 用一张 `tokenEvents = { token: "delta", delta: "text", reasoning: "text" }` 映射表把这些自定义事件缩回"token 流 + 其它"两类。四个 consumer 各自认识不同的事件子集,契约分散在六个文件里。

I-0018 的修复(2026-04-19 · `0d23ba5`)已经把 stream-client 的 WHILE 循环改成每帧让出宏任务,消除了 React 18 automatic batching 造成的"一次性蹦出"。但**事件名/字段名的自定义性本身没变**—— 我们依然:

- 不符合任何公开协议,第三方 AG-UI 兼容的前端(CopilotKit / AG-UI Inspector / LangGraph Studio 等)没法直接连到我们的后端
- 没有办法把"一次 agent run"作为一等公民暴露(缺 `RUN_STARTED` / `RUN_FINISHED` / `STEP_*`)
- 缺一个统一的 thread/run id,每个 endpoint 的 id 字段都不一样(`message_id` vs `id` vs 无)
- 想把 workspace 状态变化做成"增量补丁"只能手写 diff(我们目前是全量 snapshot + 全量重 fetch)

[AG-UI Protocol](https://docs.ag-ui.com) 是针对"LLM agent × UI"流式通信的开源协议:

- 16 个标准事件类型,覆盖生命周期(`RUN_STARTED/RUN_FINISHED/RUN_ERROR/STEP_*`)、文本消息(`TEXT_MESSAGE_START/CONTENT/END`)、工具调用(`TOOL_CALL_START/ARGS/END/RESULT`)、状态同步(`STATE_SNAPSHOT/STATE_DELTA/MESSAGES_SNAPSHOT`)、思考(`REASONING_*`)、扩展口(`CUSTOM` / `RAW`)
- 传输无关(SSE / WebSocket / HTTP-chunked 任一)
- JSON Patch(RFC 6902)作为增量状态标准
- 字段统一 camelCase,事件名 SCREAMING_SNAKE_CASE

## Decision

**v1 开始,所有 SSE streaming endpoint 必须发 AG-UI Protocol v1 兼容事件。** 保留 SSE 作为底层传输(ADR 0006 不变)· 但事件 schema 全部切到 AG-UI 标准类型。

### 必须遵守

1. **事件名**:只能用 AG-UI 标准 16 个类型之一,或 `CUSTOM` 包裹 allhands 私有语义。无论哪种,事件名必须是 AG-UI 规定的 SCREAMING_SNAKE_CASE(如 `TEXT_MESSAGE_CONTENT`、`CUSTOM`)。
2. **字段命名**:所有 AG-UI 标准字段用 camelCase(`messageId`、`toolCallId`、`threadId`、`runId`、`delta`、`snapshot`)。包在 `CUSTOM.value` 里的 allhands 私有 payload **保持后端 snake_case 原样**(避免全站重命名)。
3. **生命周期**:每一次 SSE 响应必须以 `RUN_STARTED` 开头,以 `RUN_FINISHED` 或 `RUN_ERROR` 结尾(订阅型 endpoint 如 cockpit / artifacts 例外,用 `STATE_SNAPSHOT` 开头、`RUN_ERROR` 结束异常断流)。
4. **ID 约定**:
   - `threadId` = 会话 / workspace 维度的长期 id(chat → conversation_id;cockpit/artifacts → workspace_id 或 "default";model-test → `mt_<timestamp>_<rand>`)
   - `runId` = 本次 SSE 生命周期内的短期 id(后端自生成 `run_<uuid7>`)
   - `messageId` = 助手消息的 id(每次 `TEXT_MESSAGE_START` 一个新的)
   - `toolCallId` = 后端既有 `tool_call.id`(保持原值)
5. **CUSTOM 事件命名**:`name` 字段用小写 snake_case、前缀 `allhands.`,如 `allhands.confirm_required`、`allhands.render`、`allhands.artifact_changed`、`allhands.cockpit_snapshot`。`value` 字段放原 payload。
6. **增量状态**:cockpit / artifacts 的局部变更暂用 `CUSTOM`(`allhands.cockpit_delta` / `allhands.artifact_changed`)· `STATE_DELTA`(RFC 6902 JSON Patch)列入 v2 follow-up(现在没有前端 consumer 能直接吃 JSON Patch)。
7. **心跳**:复用 AG-UI 的 `CUSTOM` · `name: "allhands.heartbeat"` · `value: {ts}`。SSE 层另写 `:` 注释行也算合法(AG-UI SSE 兼容性)。

### 实现路径(feature flag gate)

- 后端加 `AG_UI_V1` env 配置(默认 `off` for 本 PR · `on` 通过同一 PR 切换):
  - `off` → 四条 endpoint 继续发 legacy 事件(保护窗口 · 给前端 rollout 喘息)
  - `on` → 四条 endpoint 发 AG-UI 事件(**v0.3 默认开**)
- 前端 `stream-client.ts` 加两条消费路径:
  - legacy(现有 `tokenEvents` 映射)
  - AG-UI(识别 `TEXT_MESSAGE_CONTENT` / `CUSTOM` / `RUN_*` 等)
  - 自动嗅探:第一帧 `event:` 名称落在 AG-UI 标准集里即切 AG-UI 模式,否则继续 legacy
- 计划 0.3 一个 release 里同时切:**一次性切到 AG-UI · 不留长尾兼容**(feature flag 只是灰度窗口 · 跑热验证 · 不保留为永久开关)

### 具体事件映射

详见 [`docs/specs/2026-04-19-ag-ui-migration.md`](../../docs/specs/2026-04-19-ag-ui-migration.md) · 一张完整 4×N 表

## Rationale

- **生态接入**:AG-UI 被 CopilotKit / LangGraph Studio / AG-UI Inspector 原生支持 · 我们接入即拿到"第三方 inspector 调试"、"客户端 SDK"、"前端可替换"三个白送的能力。自定义协议下这些都要自己做。
- **语义更精确**:`RUN_STARTED` / `STEP_STARTED` 直接对应 ADR 0005 "L4 scope + step iteration" 的执行模型;比我们现在"token + tool_call_start + done"粗颗粒表达更清晰。
- **增量状态标准化**:AG-UI 的 `STATE_DELTA` = RFC 6902 JSON Patch · 是 workspace / artifact 层往后做"多 tab 实时同步"的唯一标准路径。现在先用 CUSTOM 顶上 · 基础设施铺好之后切过去成本只在 backend。
- **字段统一**:四条 SSE 合并为**同一套前端消费代码**(`stream-client.ts` 只有一个事件表 · 不再是 per-endpoint tokenEvents)。
- **不冲突 ADR 0006**:AG-UI 允许 SSE 传输 · 不必换 WebSocket · 所有 SSE + asyncio 的技术决策保留。

## Consequences

- 四条 endpoint 的 `_sse()` 生成器要改(约 150-200 行后端 diff)· 新增一个共享 `ag_ui_encoder.py`(~100 行 · AG-UI 事件 dataclass + `encode_sse()` 方法)
- `stream-client.ts` 增加 AG-UI 解析模式(~120 行 diff)· `tokenEvents` 映射表保留作 legacy fallback
- 四个前端 consumer(chat / model-test / cockpit / artifacts)改事件匹配分支(~30-50 行每个)
- 新增语义 hook:`onTextMessage({messageId, delta, role})` / `onToolCall({toolCallId, name, args, result})` / `onCustom({name, value})` / `onRunStarted({threadId, runId})` / `onRunFinished` / `onRunError`
- **测试**:
  - `backend/tests/unit/api/test_ag_ui_encoder.py` — encoder 契约测试(每个事件类型往返)
  - `backend/tests/integration/api/test_stream_ag_ui.py` — 4 条 endpoint 在 `AG_UI_V1=1` 下吐 AG-UI 兼容事件 · 每条 endpoint 至少一条 golden SSE wire log
  - `web/lib/__tests__/stream-client-ag-ui.test.ts` — AG-UI 模式解析单测
  - `web/tests/e2e/model-test-streaming.spec.ts` — 现有的 one-chunk 回归继续跑,外加 AG-UI 模式下断言事件名是 `TEXT_MESSAGE_CONTENT`
- **文档**:
  - `product/04-architecture.md §L8.1` 加一段 "SSE 协议 = AG-UI v1"
  - `docs/claude/reference-sources.md` 加 `ref-src-ag-ui` 指向 https://docs.ag-ui.com
- **前端 / 后端合约同步测试**:新增 `tests/contract/test_ag_ui_protocol.py` 生成 4 条 endpoint 的 golden SSE stream · 前端跑 fixture 验证能否正确解析
- **无 schema 迁移**:事件是传输层行为 · 不影响数据库 · 无 alembic migration
- **破坏性**:AG-UI 切换后 legacy 事件名**不再发出**;任何未升级的外部 consumer 会断。本仓没有外部 consumer · 内网用的 EventSource / openStream 都在同一个 PR 里切 · 风险可控

## Alternatives considered

- **A · 保持自定义 schema** · 否:错过生态、错过 JSON Patch 标准、错过未来 CopilotKit 接入。短期省 ~400 行 · 长期技术债务。
- **B · 完全迁 LangGraph Studio 的 server-events** · 否:和 LangGraph 绑死(我们虽然用 LangGraph 但 execution 层做了抽象 · 不希望把协议层也绑进去)· 也不覆盖 cockpit / artifacts(非 LangGraph 产出的流)。
- **C · 自定义 schema + 单独出一层 AG-UI adapter** · 否:维护两份语义,双倍测试,永远在"adapter 是否漏译"的 bug 里转。
- **D · 纯 WebSocket + binary protocol** · 否:SSE 已够用(ADR 0006)· binary 对 v0 调试不友好。AG-UI 允许 SSE 传输,直接用。

## 参考

- AG-UI Protocol 文档:https://docs.ag-ui.com(主站)
- Events 参考:https://docs.ag-ui.com/concepts/events
- JS SDK events:https://docs.ag-ui.com/sdk/js/core/events
- 依赖的前置 ADR:ADR 0006(SSE transport)· ADR 0005(L4 scope + run/step 模型)· ADR 0003(Tool First)
- 触发来源:I-0017(本 ADR 的驱动 issue)· I-0018(动机之一:统一 streaming 语义减少 ad-hoc bug 面)
