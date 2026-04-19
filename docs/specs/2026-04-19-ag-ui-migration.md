# AG-UI Protocol Migration · 2026-04-19

> **Spec** · 驱动 ADR: [`product/adr/0010-ag-ui-protocol-adoption.md`](../../product/adr/0010-ag-ui-protocol-adoption.md)
> **Issue:** [`docs/issues/open/I-0017-ag-ui-protocol-migration.md`](../issues/open/I-0017-ag-ui-protocol-migration.md)
> **Track:** J
>
> 本文档是 ADR 0010 的**实现说明书** · 给 Phase 4 PR 作者。读完应当能按表 1:1 改后端每个 `yield` 语句,不需要再思考"这个事件该映射到哪个 AG-UI 类型"。

---

## 1. 协议基线

### 1.1 SSE 线协议

不变:`text/event-stream` · `X-Accel-Buffering: no` · `Cache-Control: no-cache` · 保留既有 CORS / 路径结构。

### 1.2 帧格式

```
event: <AG_UI_TYPE>\n
data: <json>\n
\n
```

- `<AG_UI_TYPE>` 是 AG-UI 16 个标准类型之一(SCREAMING_SNAKE_CASE),或 `CUSTOM`。
- `<json>` 字段名 camelCase(AG-UI 标准字段);`CUSTOM.value` 内部允许 snake_case(allhands 私有)。
- 所有事件必须含 `type` 字段(值等于 `event:` 行),为了把原始帧回灌给 AG-UI SDK 时能反解析。

### 1.3 基础字段(所有事件)

```ts
{
  type: "TEXT_MESSAGE_START" | ... | "CUSTOM",
  timestamp?: number,   // ms since epoch · 可选 · 后端默认填
  rawEvent?: unknown,   // 可选 · 用于 RAW 包裹
}
```

### 1.4 ID 约定

| ID | 来源 | 生命周期 | 举例 |
|---|---|---|---|
| `threadId` | Chat → conversation_id · Cockpit → "default" · Artifacts → workspace_id · Model-test → `mt_<ts>_<rand>` | 长期 · 可跨请求 | `conv_01HFA…` |
| `runId` | 每条 SSE 响应后端新起 UUIDv7 | 本次 SSE 开始 → `RUN_FINISHED/ERROR` 结束 | `run_01J…` |
| `messageId` | `TEXT_MESSAGE_START` 一次一个 · 源:AgentRunner 产出的 message id 或 UUIDv7 | 该文本消息的流式期 | `msg_01J…` |
| `toolCallId` | 后端原 `tool_call.id`(LangGraph 分配) | 一次工具调用 | `call_abc123` |
| `stepName` | 可选 · `STEP_STARTED/FINISHED` 的 step 名 | 一次 step 内 | `"agent.think"` |

### 1.5 生命周期骨架

每条响应的必含结构:

```
event: RUN_STARTED
data: {"type":"RUN_STARTED","threadId":"…","runId":"…"}

…  (中间事件 · 见 §2)

event: RUN_FINISHED
data: {"type":"RUN_FINISHED","threadId":"…","runId":"…"}
```

出错:

```
event: RUN_ERROR
data: {"type":"RUN_ERROR","message":"human-readable","code":"TOOL_TIMEOUT"}
```

订阅型(cockpit / artifacts):开头可先发 `STATE_SNAPSHOT` 再发 `RUN_STARTED`,或直接 `RUN_STARTED` + 首个 `CUSTOM: allhands.cockpit_snapshot` · 两种都合规(推荐后者 · 和 chat / model-test 结构一致)。

---

## 2. 映射总表

### 2.1 `POST /api/conversations/{id}/messages`(chat)

| 原事件 | 原 payload | → AG-UI 事件 | → AG-UI payload | 备注 |
|---|---|---|---|---|
| (无) | — | `RUN_STARTED` | `{threadId: conversation_id, runId}` | 流开头新发 |
| `token` | `{message_id, delta}` | `TEXT_MESSAGE_START`(一次) + N× `TEXT_MESSAGE_CONTENT` | `START: {messageId, role:"assistant"}` · `CONTENT: {messageId, delta}` | 同一 `message_id` 只发一次 START;之后 `CONTENT` 复用 `messageId`;切换 `message_id` 或流结束时发 `TEXT_MESSAGE_END` |
| `tool_call_start` | `{tool_call}` | `TOOL_CALL_START` + 条件 `TOOL_CALL_ARGS` | `{toolCallId: tool_call.id, toolCallName: tool_call.tool_id}` · `ARGS: {toolCallId, delta: json_str(tool_call.args)}` | `tool_call.args` 如果已完整,发一次 `TOOL_CALL_ARGS` 带全量 JSON;若后端有 args-streaming 才分多次发 |
| `tool_call_end` | `{tool_call}` | `TOOL_CALL_END` + `TOOL_CALL_RESULT`(如 `result` 存在) | `END: {toolCallId}` · `RESULT: {toolCallId, content: json_str(result)}` | `RESULT.content` 是 string;如 `result` 是 dict,前端 JSON.parse |
| `confirm_required` | `{confirmation_id, tool_call_id, summary, rationale, diff}` | `CUSTOM` | `{name: "allhands.confirm_required", value: {confirmation_id, tool_call_id, summary, rationale, diff}}` | 私有语义 · snake_case 保留 |
| `confirm_resolved` | `{confirmation_id, status}` | `CUSTOM` | `{name: "allhands.confirm_resolved", value: {confirmation_id, status}}` | 同上 |
| `render` | `{message_id, payload}` | `CUSTOM` | `{name: "allhands.render", value: {message_id, payload}}` | `payload.component` 指向前端组件注册表 · 前端识别 `name === "allhands.render"` 后走 `<RenderRegistry>` |
| `nested_run_start` | `{run_id, parent_run_id, employee_name}` | `STEP_STARTED` + `CUSTOM` | `STEP: {stepName: "nested_run." + employee_name}` · `CUSTOM: {name: "allhands.nested_run", value: {run_id, parent_run_id, employee_name, phase: "start"}}` | STEP 给通用 UI 消费 · CUSTOM 给 allhands tree view |
| `nested_run_end` | `{run_id, status}` | `STEP_FINISHED` + `CUSTOM` | `STEP: {stepName: "nested_run." + <same>}` · `CUSTOM: {name: "allhands.nested_run", value: {run_id, status, phase: "end"}}` | 同上 |
| `trace` | `{trace_id, url?}` | `CUSTOM` | `{name: "allhands.trace", value: {trace_id, url}}` | LangFuse 链接 · 非 AG-UI 语义 |
| `error` | `{code, message}` | `RUN_ERROR` | `{message, code}` | 结束流 |
| `done` | `{message_id, reason}` | `TEXT_MESSAGE_END` + `RUN_FINISHED` | `END: {messageId}` · `FINISHED: {threadId, runId}` | 先 END 再 FINISHED;若没开过 START 就直接 FINISHED |

### 2.2 `GET /api/cockpit/stream`(cockpit workspace live)

| 原事件 | 原 payload | → AG-UI 事件 | → AG-UI payload | 备注 |
|---|---|---|---|---|
| (无) | — | `RUN_STARTED` | `{threadId: "cockpit", runId}` | 订阅流也发 |
| `snapshot` | WorkspaceSummaryDto | `CUSTOM` | `{name: "allhands.cockpit_snapshot", value: <dto>}` | v2 考虑升级为 `STATE_SNAPSHOT` |
| `activity` | `{id, kind, ts, payload}` | `CUSTOM` | `{name: "allhands.cockpit_activity", value: {id, kind, ts, payload}}` | |
| `run_update` | 同上 `kind ∈ {run.started, run.updated}` | `CUSTOM` | `{name: "allhands.cockpit_run_update", value: {id, kind, ts, payload}}` | |
| `run_done` | `kind ∈ {run.finished, run.cancelled}` | `CUSTOM` | `{name: "allhands.cockpit_run_done", value: {id, kind, ts, payload}}` | |
| `health` | `{kind: "health.updated", payload}` | `CUSTOM` | `{name: "allhands.cockpit_health", value: {id, ts, payload}}` | |
| `kpi` | `{kind: "kpi.updated", payload}` | `CUSTOM` | `{name: "allhands.cockpit_kpi", value: {id, ts, payload}}` | |
| `heartbeat` | `{ts}` | `CUSTOM` | `{name: "allhands.heartbeat", value: {ts}}` | 统一跨 endpoint 心跳名 |
| `error` | `{code, message}` | `RUN_ERROR` | `{message, code}` | 结束流 |

### 2.3 `GET /api/artifacts/stream`(artifact push)

| 原事件 | 原 payload | → AG-UI 事件 | → AG-UI payload | 备注 |
|---|---|---|---|---|
| (无) | — | `RUN_STARTED` | `{threadId: workspace_id or "default", runId}` | |
| `ready` | `{ts}` | `CUSTOM` | `{name: "allhands.artifacts_ready", value: {ts}}` | |
| `artifact_changed` | `{id, kind: "artifact_changed", ts, payload: {artifact_id, op, ...}}` | `CUSTOM` | `{name: "allhands.artifact_changed", value: {id, ts, artifact_id, op, ...}}` | v2 可升级为 `STATE_DELTA` with JSON Patch |
| `heartbeat` | `{ts}` | `CUSTOM` | `{name: "allhands.heartbeat", value: {ts}}` | |
| `error` | `{code, message}` | `RUN_ERROR` | `{message, code}` | |

### 2.4 `POST /api/models/{id}/test/stream`(model test dialog)

| 原事件 | 原 payload | → AG-UI 事件 | → AG-UI payload | 备注 |
|---|---|---|---|---|
| (无) | — | `RUN_STARTED` | `{threadId: "model-test", runId}` | |
| `meta` | `{model, started_at_ms}` | `CUSTOM` | `{name: "allhands.model_test_meta", value: {model, started_at_ms}}` | 非 AG-UI 语义 |
| `reasoning` | `{text}` | `REASONING_MESSAGE_CHUNK` | `{messageId, delta: text, role: "assistant"}` | 第一帧自动展开为 START → CONTENT |
| `delta` | `{text}` | `TEXT_MESSAGE_CHUNK` | `{messageId, delta: text, role: "assistant"}` | 第一帧自动展开为 START → CONTENT |
| `done` | `{latency_ms, ttft_ms, reasoning_first_ms?, usage, tokens_per_second, response, reasoning_text?}` | `TEXT_MESSAGE_END` + `CUSTOM` + `RUN_FINISHED` | `END: {messageId}` · `CUSTOM: {name: "allhands.model_test_metrics", value: {latency_ms, ttft_ms, ...}}` · `FINISHED: {threadId, runId}` | metrics 通过 CUSTOM 把原 payload 整体搬 |
| `error` | `{error, error_category, latency_ms}` | `RUN_ERROR` + `CUSTOM` | `ERROR: {message: error, code: error_category}` · `CUSTOM: {name: "allhands.model_test_error", value: {error, error_category, latency_ms}}` | 结构化错误放 CUSTOM |

---

## 3. 后端实现结构

### 3.1 新文件 `backend/src/allhands/api/ag_ui_encoder.py`

职责:把 AG-UI 事件(Python dataclass / Pydantic)序列化为 SSE 帧 bytes。单文件约 100-150 行。

```python
from __future__ import annotations
from pydantic import BaseModel
from typing import Any, Literal
import json

AG_UI_EVENT = Literal[
    "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END", "TEXT_MESSAGE_CHUNK",
    "TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END", "TOOL_CALL_RESULT",
    "STATE_SNAPSHOT", "STATE_DELTA", "MESSAGES_SNAPSHOT",
    "STEP_STARTED", "STEP_FINISHED",
    "RUN_STARTED", "RUN_FINISHED", "RUN_ERROR",
    "REASONING_START", "REASONING_MESSAGE_START", "REASONING_MESSAGE_CONTENT",
    "REASONING_MESSAGE_END", "REASONING_MESSAGE_CHUNK", "REASONING_END",
    "RAW", "CUSTOM",
]

class AgUiEvent(BaseModel):
    type: AG_UI_EVENT
    timestamp: int | None = None
    # … all AG-UI fields, camelCase:
    threadId: str | None = None
    runId: str | None = None
    messageId: str | None = None
    role: str | None = None
    delta: str | None = None
    toolCallId: str | None = None
    toolCallName: str | None = None
    content: str | None = None
    snapshot: dict[str, Any] | None = None
    # CUSTOM:
    name: str | None = None
    value: Any = None
    # STATE_DELTA:
    # delta: list[dict] -- reuse `delta` field type union? use separate field `patch`
    patch: list[dict[str, Any]] | None = None
    # RUN_ERROR:
    message: str | None = None
    code: str | None = None
    # STEP:
    stepName: str | None = None

def encode_sse(event: AgUiEvent) -> bytes:
    body = event.model_dump(mode="json", exclude_none=True)
    # `type` already in body
    return f"event: {event.type}\ndata: {json.dumps(body, ensure_ascii=False)}\n\n".encode()

# Factories for common sequences:
def text_message_start(message_id: str, role: str = "assistant") -> AgUiEvent: ...
def text_message_content(message_id: str, delta: str) -> AgUiEvent: ...
def text_message_end(message_id: str) -> AgUiEvent: ...
def custom(name: str, value: Any) -> AgUiEvent: ...
def run_started(thread_id: str, run_id: str) -> AgUiEvent: ...
def run_finished(thread_id: str, run_id: str) -> AgUiEvent: ...
def run_error(message: str, code: str | None = None) -> AgUiEvent: ...
```

### 3.2 每条 endpoint 的改法(示意 · chat.py)

```python
# before
async def _sse():
    async for event in runner.run(...):
        yield f"event: {event.kind}\ndata: {json.dumps(event.payload)}\n\n".encode()

# after
from allhands.api.ag_ui_encoder import (
    encode_sse, run_started, run_finished, run_error,
    text_message_start, text_message_content, text_message_end,
    tool_call_start, tool_call_end, tool_call_result, custom,
)
from uuid import uuid7

async def _sse():
    thread_id = conversation_id
    run_id = f"run_{uuid7().hex}"
    yield encode_sse(run_started(thread_id, run_id))
    current_message_id: str | None = None
    try:
        async for event in runner.run(...):
            if event.kind == "token":
                msg_id = event.payload["message_id"]
                if current_message_id != msg_id:
                    if current_message_id is not None:
                        yield encode_sse(text_message_end(current_message_id))
                    yield encode_sse(text_message_start(msg_id))
                    current_message_id = msg_id
                yield encode_sse(text_message_content(msg_id, event.payload["delta"]))
            elif event.kind == "tool_call_start":
                # ... (per mapping table §2.1)
            elif event.kind == "confirm_required":
                yield encode_sse(custom("allhands.confirm_required", event.payload))
            # ... etc
            elif event.kind == "done":
                if current_message_id is not None:
                    yield encode_sse(text_message_end(current_message_id))
                yield encode_sse(run_finished(thread_id, run_id))
            elif event.kind == "error":
                yield encode_sse(run_error(event.payload["message"], event.payload.get("code")))
    except Exception as e:
        yield encode_sse(run_error(str(e), "INTERNAL"))
```

四条 endpoint 都用同一个 pattern · 每条 ~30-60 行 diff。

### 3.3 Feature flag

`backend/src/allhands/config/settings.py`:

```python
class Settings(BaseSettings):
    ag_ui_v1: bool = Field(default=False, alias="AG_UI_V1")
```

每个 `_sse()` 开头:

```python
if settings.ag_ui_v1:
    yield from _sse_ag_ui()
else:
    yield from _sse_legacy()
```

legacy 函数就是把原来 `_sse` body 抽出来。AG-UI 函数按 §3.2 写。

---

## 4. 前端实现结构

### 4.1 `web/lib/stream-client.ts` 扩展

新增语义 hook:

```ts
export type StreamClientCallbacks = {
  // legacy (retained for fallback)
  onToken?: (delta: string, frame: StreamEventFrame) => void;
  onMetaEvent?: (frame: StreamEventFrame) => void;

  // AG-UI hooks (preferred)
  onRunStarted?: (e: { threadId: string; runId: string }) => void;
  onRunFinished?: (e: { threadId: string; runId: string }) => void;
  onRunError?: (e: { message: string; code?: string }) => void;
  onTextMessage?: (e: { messageId: string; delta: string; role: string; phase: "start" | "content" | "end" | "chunk" }) => void;
  onReasoning?: (e: { messageId: string; delta: string; phase: "start" | "content" | "end" | "chunk" }) => void;
  onToolCall?: (e: { toolCallId: string; toolCallName?: string; delta?: string; content?: string; phase: "start" | "args" | "end" | "result" }) => void;
  onStep?: (e: { stepName: string; phase: "start" | "end" }) => void;
  onCustom?: (e: { name: string; value: unknown }) => void;

  onDone?: () => void;
  onError?: (err: Error) => void;
  signal?: AbortSignal;
  tokenEvents?: Record<string, string>;
};
```

### 4.2 模式嗅探

```ts
// Inside drain loop, first frame decides mode:
let mode: "legacy" | "ag-ui" | null = null;
const AG_UI_EVENTS = new Set([
  "RUN_STARTED", "RUN_FINISHED", "RUN_ERROR",
  "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END", "TEXT_MESSAGE_CHUNK",
  "TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_END", "TOOL_CALL_RESULT",
  "REASONING_MESSAGE_CHUNK", "REASONING_MESSAGE_START", "REASONING_MESSAGE_CONTENT", "REASONING_MESSAGE_END",
  "STEP_STARTED", "STEP_FINISHED",
  "STATE_SNAPSHOT", "STATE_DELTA", "MESSAGES_SNAPSHOT",
  "CUSTOM", "RAW",
]);

if (mode === null) mode = AG_UI_EVENTS.has(frame.event) ? "ag-ui" : "legacy";

if (mode === "ag-ui") dispatchAgUi(frame, callbacks);
else dispatchLegacy(frame, callbacks);
```

### 4.3 Consumer 迁移(4 个)

- **ModelTestDialog**:原 `onToken(delta)` 继续 work(legacy 模式);AG-UI 模式改用 `onTextMessage` / `onReasoning`;`onCustom(e)` 分支 `e.name === "allhands.model_test_metrics"` → 读 `e.value` 设置 metrics 卡片。
- **chat InputBar**:改用 `onTextMessage` / `onToolCall` / `onCustom`(confirm_required / render / nested_run / trace 全走 `onCustom(name ∈ allhands.*)`)。
- **Cockpit**:改用 `onCustom` 消费 `allhands.cockpit_*` · `onRunError` → 走既有重连逻辑。
- **ArtifactPanel**:同上,监听 `allhands.artifact_changed` / `allhands.artifacts_ready` / `allhands.heartbeat`。

### 4.4 保留宏任务让出

I-0018 的 `await new Promise(r => setTimeout(r, 0))` 继续保留 · 在 AG-UI 模式下**同样需要**,因为 AG-UI 的 `TEXT_MESSAGE_CONTENT` 帧密度和原 `token` 帧完全相同,React 18 batching 问题不变。

---

## 5. 测试清单(Phase 4 DoD)

### 5.1 Backend

- `backend/tests/unit/api/test_ag_ui_encoder.py` — 每个事件类型一个 `encode_sse()` 往返(bytes → parse → equal):≥20 用例
- `backend/tests/integration/api/test_stream_ag_ui.py` — 4 条 endpoint 在 `AG_UI_V1=1` 下:
  - chat · `test_chat_run_emits_ag_ui_envelope` — 注入一段 token stream + 一个 tool call,断言 `event:` 行依次是 `RUN_STARTED`/`TEXT_MESSAGE_START`/`TEXT_MESSAGE_CONTENT`×N/`TEXT_MESSAGE_END`/`TOOL_CALL_START`/`TOOL_CALL_ARGS`/`TOOL_CALL_END`/`TOOL_CALL_RESULT`/`RUN_FINISHED`
  - cockpit · `test_cockpit_stream_emits_ag_ui_snapshot` — 订阅 stream,断言首帧 `RUN_STARTED` · 第二帧 `CUSTOM: allhands.cockpit_snapshot` · 后续 delta `CUSTOM: allhands.cockpit_*`
  - artifacts · `test_artifacts_stream_emits_ag_ui_custom`
  - model-test · `test_model_test_stream_emits_ag_ui_text_chunks` — `TEXT_MESSAGE_CHUNK` × N + `CUSTOM: allhands.model_test_metrics` + `RUN_FINISHED`
- `backend/tests/integration/api/test_stream_legacy_still_works.py` — 同样 4 条 endpoint 在 `AG_UI_V1=0` 下继续发原事件(迁移安全网)

### 5.2 Frontend

- `web/lib/__tests__/stream-client-ag-ui.test.ts` — AG-UI 模式下每个 hook 一次用例(onRunStarted / onTextMessage / onToolCall / onCustom)
- `web/lib/__tests__/stream-client.test.ts` — 现有 10 个用例保留(legacy 路径)
- `web/tests/e2e/model-test-streaming.spec.ts` — 保留 · 在 AG-UI 模式下一条额外断言 `event: TEXT_MESSAGE_CHUNK` 或 `TEXT_MESSAGE_CONTENT` 出现 ≥5 次
- `web/components/chat/__tests__/InputBar-ag-ui.test.tsx` — 新增 · 注入 AG-UI fixture 流,断言 `TEXT_MESSAGE_CONTENT` 聚合后文本与原 `token` 测试结果一致

### 5.3 Contract

- `backend/tests/contract/test_ag_ui_protocol.py` — 每条 endpoint 生成一条 golden SSE stream(bytes fixture),存到 `web/tests/fixtures/ag_ui/*.sse`;前端 `web/lib/__tests__/stream-client-ag-ui.test.ts` 读 fixture 跑回归 · 确保前后端 schema 不漂移

### 5.4 Wire-log 证据

Phase 4 完成后,`TRACK-J-DONE.md` 必须附上每条 endpoint 在 AG-UI 模式下的真实 SSE wire log(用前面 I-0018 诊断用的 `/tmp/sse_stamp.sh` 或仓内 `web/tests/e2e/helpers/sse_stamp.ts` 抓取),供 PR review 一眼看到事件名与字段命名正确。

---

## 6. 分阶段交付(Phase 4 PR 切法)

每个 PR ≤300 行(含测试)· 独立可合并:

| PR | 范围 | 目标 LOC |
|---|---|---|
| P4.1 | `ag_ui_encoder.py` + unit 测试 | ~250 |
| P4.2 | `stream-client.ts` AG-UI 分支 + unit 测试 + feature-flag 嗅探 | ~250 |
| P4.3 | chat endpoint 迁移 + chat integration 测试 + chat consumer 迁移 | ~280 |
| P4.4 | cockpit + artifacts endpoint 迁移 + 对应 consumer 迁移 + integration 测试 | ~280 |
| P4.5 | model-test endpoint 迁移 + consumer 迁移 + e2e 断言扩展 + `AG_UI_V1` 默认开 + legacy dead code 清理 | ~280 |

5 个 PR 合起来 ~1340 行 · 含测试。若 P4.5 删除 legacy 代码超额 · 把清理拆成 P4.6。

---

## 7. 风险与 rollback

- **AG-UI SDK 字段变化**:协议是 v1 · 但仍在迭代。锁字段表以本文档为准 · 若协议升级出 v2,重走 ADR 流程。
- **消费端漏译**:通过"contract 测试 + fixture"防御;每条 endpoint 的 golden SSE 必须由两边同时吃通过。
- **rollback**:`AG_UI_V1=0` 立即回到 legacy · P4.1/P4.2 不破坏 legacy 路径 · P4.3 起每个 PR 也都保留了 legacy 分支 · P4.5 把 flag 默认值切 true 但**不删 legacy 代码** · 留一个 release 的安全窗口。

---

## 8. 非目标(本 spec 明确不做)

- ❌ `STATE_DELTA`(RFC 6902 JSON Patch)· 留到 v2:cockpit / artifacts 先用 CUSTOM 顶上
- ❌ `MESSAGES_SNAPSHOT`(全量消息历史重发)· v0 chat 没有"断线重连拉全历史"需求
- ❌ `ACTIVITY_SNAPSHOT` / `ACTIVITY_DELTA`(结构化 activity)· v1 用 CUSTOM 覆盖
- ❌ 把外部 provider SSE(OpenAI / DashScope compat)同步转 AG-UI · backend 内部照原样消费 · 只把 `test_model_stream` 的**输出端**换成 AG-UI
- ❌ WebSocket / binary protocol · ADR 0006 决定 SSE,不变
