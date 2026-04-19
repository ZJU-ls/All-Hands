---
id: I-0017
severity: P0
status: open
title: 前后端 SSE/streaming 协议统一迁移到 AG-UI Protocol · 自定义事件名不符合 AI-native 行业标准
affects: backend/api/routers/{cockpit,artifacts,conversations,models}.py · web/lib/stream-client.ts · 所有 EventSource/fetch-stream 消费点
discovered: 2026-04-19 / user-product-review(Wave-2 merge 后用户反馈)
blocker-for: Wave-3 AI-native · CopilotKit / 外部 AG-UI 客户端接入 · L01 Tool First extension
tags: arch, api, streaming, protocol
---

## Repro

打开任何现有 SSE 流:
- `/api/cockpit/stream`(Track B)
- `/api/artifacts/stream`(Track A)
- `/api/conversations/{id}/messages`(chat)
- `/api/models/{id}/test/stream`(gateway / Track D)

用 `curl -N` 观察 wire format:
```
event: delta
data: {"text": "..."}

event: reasoning
data: {"text": "..."}

event: done
data: {...}
```

## Expected

**前后端都走 AG-UI Protocol(https://docs.ag-ui.com)**,事件名遵循 AG-UI 规范:

- `RUN_STARTED` / `RUN_FINISHED` / `RUN_ERROR`
- `STEP_STARTED` / `STEP_FINISHED`
- `TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_END`
- `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` / `TOOL_CALL_RESULT`
- `STATE_SNAPSHOT` / `STATE_DELTA`
- `RAW` / `CUSTOM`(扩展点)

allhands 的 domain-specific 事件(artifact_changed / cockpit heartbeat / render envelope / reasoning tokens 等)作为 **AG-UI 上的 CUSTOM / STATE_DELTA 扩展**,不是自创事件名。

## Actual

- 全仓 `grep -rn "ag-ui\|agui\|CopilotKit"` = 0 命中 · 当前是完全自定义 SSE
- 每个 endpoint 的事件名、data schema 都是 ad-hoc,互不兼容
- 前端 `stream-client.ts` 的 `tokenEvents` 字典手动维护每条流的 event→field 映射
- 无法直接接 AG-UI 生态的客户端(CopilotKit / 其他 Agent UI)

## 评估方向

1. **Inventory** 所有现役 SSE 端点 + 事件 schema(models / cockpit / artifacts / conversations)· 列到 ADR
2. **Design** AG-UI 映射表:自定义事件 → AG-UI 标准事件 + allhands 扩展字段
3. **ADR-0010** 记录协议决策 · 引用 ag-ui.com 规范
4. **后端适配层**:在 routers 下加一层 `ag_ui_encoder.py`,把业务事件 pack 成 AG-UI 帧
5. **前端适配层**:`stream-client.ts` 改读 AG-UI 事件,`onToken`/`onMetaEvent` 用 AG-UI 事件名
6. **回归测试**:每条流至少 1 条 integration 验证 AG-UI 帧格式,1 条 e2e 验证消费端能实时渲染

## 相关

- 阻塞 I-0018(model test stream 当前非流式 · 迁移后重新验证)
- 如果采用 `@ag-ui/core` npm 包 + python 对端,确认版本策略和扩展点
- 视情况引入 `ref-src-ag-ui`:AG-UI protocol 的 reference implementation
