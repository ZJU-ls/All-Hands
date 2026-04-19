---
id: I-0017
severity: P0
status: open
title: 前后端 SSE/streaming 协议统一迁移到 AG-UI Protocol · 自定义事件名不符合 AI-native 行业标准
affects: backend/api/routers/{cockpit,artifacts,chat,models}.py · web/lib/stream-client.ts · 所有 EventSource/fetch-stream 消费点
discovered: 2026-04-19 / user-product-review(Wave-2 merge 后用户反馈)
blocker-for: Wave-3 AI-native · CopilotKit / 外部 AG-UI 客户端接入 · L01 Tool First extension
tags: arch, api, streaming, protocol
---

## 背景

v0 MVP 期间 4 条 SSE 路全部是**自定义事件名**(2026-04-19 盘点):

| endpoint | 事件名 | 数据字段 |
|---|---|---|
| `POST /api/conversations/{id}/messages` | `token` / `tool_call_*` / `reasoning` / `confirm_required` / `trace` / `render` / `done` / `error` | `data.delta` / 各自 |
| `GET /api/cockpit/stream` | `snapshot` / `activity` / `run_update` / `run_done` / `health` / `kpi` / `heartbeat` / `error` | 各自 |
| `GET /api/artifacts/stream` | `artifact_changed` / `heartbeat` / `error` | 各自 |
| `POST /api/models/{id}/test/stream` | `meta` / `reasoning` / `delta` / `done` / `error` | `data.text` / 各自 |

每条新 SSE feature 都需要前后端对齐 event name + data schema · **契约漂移是时间问题**。前端 `stream-client.ts` 的 `DEFAULT_TOKEN_EVENTS` 已经需要同时认两套 token 字段(`token.delta` vs `delta.text`)· 这种"适配表"会继续膨胀。

## Repro

```bash
curl -N http://localhost:8000/api/cockpit/stream
# → event: snapshot / event: heartbeat / event: run_update …(自定义)

curl -N -X POST http://localhost:8000/api/models/<id>/test/stream -d '{"prompt":"hi"}'
# → event: meta / event: delta / event: done(自定义)
```

全仓 `grep -rn "ag-ui\|agui\|CopilotKit"` = 0 命中 · 完全自定义。

## Expected

**前后端都走 AG-UI Protocol**(https://docs.ag-ui.com),事件名遵循 AG-UI 规范:

- `RUN_STARTED` / `RUN_FINISHED` / `RUN_ERROR`
- `STEP_STARTED` / `STEP_FINISHED`
- `TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_END`
- `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` / `TOOL_CALL_RESULT`
- `STATE_SNAPSHOT` / `STATE_DELTA`
- `RAW` / `CUSTOM`(扩展点)

allhands-specific 事件(artifact_changed / cockpit kpi / heartbeat / reasoning / render envelope)作为 **AG-UI 上的 CUSTOM 扩展**,不是自创事件名。

## 验收标准

- [x] `product/adr/0010-ag-ui-protocol-adoption.md` 落地 · Context / Decision / Rationale / Consequences / Alternatives 齐
- [x] `docs/specs/2026-04-19-ag-ui-migration.md` 映射表完整(4 条 SSE × 所有事件 → AG-UI 标准 OR 扩展类型)
- [x] `backend/src/allhands/api/ag_ui_encoder.py` · 对外暴露 `encode_text_delta` / `encode_text_start` / `encode_text_end` / `encode_custom` / `encode_state_snapshot` / `encode_state_delta` / `encode_run_error` / `encode_run_finished` 等
- [ ] 4 条 SSE endpoint 全部切到 encoder · wire 上肉眼能看到 `event: TEXT_MESSAGE_CONTENT` 等 AG-UI 标准事件名
- [ ] `web/lib/stream-client.ts` 读 AG-UI · 提供 onTextStart/onTextDelta/onTextEnd/onToolCall/onCustom/onStateSnapshot/onStateDelta 语义 hook
- [ ] 4 个 consumer(chat / cockpit / artifacts / model-test)切到新 hook · 不再直接读 event name
- [ ] 回归测试:
  - `backend/tests/integration/test_ag_ui_wire_format.py` · 断言每条 endpoint 的 wire 帧是 AG-UI 标准
  - `web/lib/__tests__/stream-client.ag-ui.test.ts` · 覆盖所有 AG-UI hook
  - `web/tests/e2e/*-streaming.spec.ts` · e2e 端到端仍然能打字机

## 相关

- 规范源:https://docs.ag-ui.com · `ref-src-ag-ui`
- 关联 issue:I-0018(streaming bug · 同一 stream-client · 同一修法)
- 关联 ADR:0010(本 issue 的产出)

---

## 工作记录

### 2026-04-19 · in-progress · track-j
- 已录 · 与 I-0018 同一 track 推进
- 阶段 1:ADR-0010 + migration spec 落地(commit `9f38ac9`)
- 阶段 2:`ag_ui_encoder.py` 基础设施(commit `4f47f6f`)
- 阶段 3:4 条 endpoint + stream-client + 4 consumer 全迁

---

## 关闭记录

_留待关闭时填写。_
