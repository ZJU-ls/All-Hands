---
id: I-0016
severity: P0
status: closed
title: AI 输出没有打字机/流式效果 · 所有消费点都应接 SSE · AI 原生基本条件
affects: web/lib/chat-client · web/components/chat/MessageBubble · `/models` 测试 · 所有调用 agent 的页面
discovered: 2026-04-19 / user-product-review
blocker-for: AI 原生产品基本体验 · chat UX DoD
tags: ui, api, streaming, product-quality
---

# I-0016 · 流式输出(打字机效果)必须在所有 AI 输出处都具备

## 现象

用户发现模型测试对话不支持流式输出 · 等后端跑完一整段才一次性 render 出来 · 这不是 AI 原生产品的标准。

backend `chat.py` 已经用 `StreamingResponse(text/event-stream)` 了 · 但前端在多处没有消费 SSE · 或消费了但没有"字逐字出"的 render 效果。

## 原则

**所有 LLM 输出都应该流式渲染**。凡是 agent 输出文本的位置(主对话 / 模型测试 / skill 试运行 / trigger 预演 / stock-assistant briefing 预览)都要:
1. 前端以 SSE / EventSource 消费
2. MessageBubble 组件支持 incremental 文本追加
3. 光标 / typewriter 视觉提示(用 mono 字符 `▍` 或静态 pulse-dot · 不用动画库)
4. 流结束(stream end event)→ 光标消失

## DoD

- [ ] 建或重构 `web/lib/stream-client.ts` · 统一的 SSE 消费封装 · 支持:onToken / onMetaEvent / onDone / onError / abort
- [ ] 建或重构 `web/components/chat/MessageBubble.tsx` 支持 streaming prop · 未完 → 末尾 ▍ · 完 → 清
- [ ] 审计所有调用 agent 的前端位置 · 都切到 stream-client:
  - 主对话(已有?扫一下)
  - `/models/[id]/test` 模型测试(本次 trigger)
  - `/skills/[id]/preview`(如有)
  - `/triggers/[id]/preview`(如有)
  - `/stock-assistant/setup` 里的试验框
  - cockpit live log(已经 SSE · 顺手检查)
- [ ] backend 确认 `/api/chat` 流有文本 delta 事件(tool call start / tool call end 等 meta 也应 emit)· 不足就补
- [ ] vitest 单元:stream-client 对一系列 mock 事件的解析正确
- [ ] integration test:一个真 agent run · assert 前端 MessageBubble 收到 ≥ 2 次 incremental update · 最终文本等于一次性 output
- [ ] e2e(playwright):在 `/models/[id]/test` 发一条 → 观察到 typewriter 效果(可以用 `waitFor` + length 变化断言)

## 触发来源

- 2026-04-19 用户产品评审:"还是不支持流失输出 · 我觉得流式输出(打字机效果)是所有 AI 原生平台应该具备的基本条件 · 所有的地方按理说都是可以流逝输出的"

## 配合 I-0015

I-0015 的 send→stop 切换依赖这个 streaming 状态机 · 建议同一 track 做。

## 关闭记录

- 2026-04-19 · fix-chat-ux (Track D):
  - `aae5a6b` — unified `web/lib/stream-client.ts` (SSE consumer · onToken/onMetaEvent/onDone/onError/abort · tokenEvents routing)
  - `aae5a6b` — `MessageBubble.tsx` streaming cursor (`▍`, via `ah-caret` CSS keyframe · no animation lib)
  - `3e2b7c3` — backend `chat.py` drains generator on disconnect → streams stay abortable end-to-end
  - `2a83152` — InputBar + ModelTestDialog migrated to stream-client (every agent consumer now streams; dead `sendMessage` helper removed)
- 审计范围:`docs/chat-ux-audit.md` 枚举所有 agent 输出入口。主对话 + ModelTestDialog 是仅有的两个流式消费点;其余(tasks 面板、cockpit log)是只读日志/表单,本次豁免说明见 audit 文档。
- 回归测试:
  - `web/lib/__tests__/stream-client.test.ts` — parser + abort + reasoning routing + HTTP 500 onError
  - `backend/tests/integration/test_chat_cancel.py` — generator `aclose()` fires on disconnect
  - `web/tests/e2e/chat-ux.spec.ts` — typewriter 效果(assistant text length 持续增长)· abort mid-stream · resend 正常
