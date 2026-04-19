---
id: I-0018
severity: P0
status: open
title: /gateway 模型对话测试观感为非流式 · 字符一次性蹦出而非逐字出现
affects: web/components/gateway/ModelTestDialog.tsx · backend/services/model_service.astream_chat_test · Next.js rewrites over SSE
discovered: 2026-04-19 / user-product-review(Wave-2 merge 后,用户实测)
blocker-for: AI-native DoD · I-0016 "全平台流式输出" 本该已覆盖
tags: ui, streaming, bug, user-facing
---

## Repro

1. `pnpm dev`(web:3000)+ `uv run uvicorn allhands.main:app --reload --port 8000`(backend)
2. 打开 `/gateway` → 选一个已配置的 model(走活的 provider,如 DashScope / 百炼)
3. 点模型卡片的「测试」 → 对话框出来
4. 输入 prompt → 点「发送」(或 ↵)

## Expected

字符**逐帧**追加到 `MessageRow`:看到打字机光标 `▍` 一边闪一边往前推,字一个一个蹦出来(与 ChatGPT / Claude / Gemini web 相同)。

## Actual

页面等若干秒**没有任何字符**,然后**整段回复一次性显示**。虽然 `data-testid="model-test-cursor"` / `phase=answering` 等 DOM 层 streaming 状态是对的,但视觉上看不到 delta 出现。

## 可能根因(由近到远,track 需要逐条排除)

1. **Next.js rewrites 代理缓冲 SSE**(最可能)
   - [web/next.config.ts:5-15](web/next.config.ts) 用 `rewrites()` 把 `/api/*` proxy 到 backend。Next 15 的 `fetch`-based proxy 对 SSE 的支持有 edge case,特别是当 upstream 没发 `Content-Encoding: identity` 或 gzip 被中间层尝试解包时
   - 验证:`curl -N -X POST http://localhost:8000/api/models/<id>/test/stream ...` 直连 backend,看是否逐帧出。再 `curl -N http://localhost:3000/api/models/<id>/test/stream ...` 走 proxy,对比
2. **上游 provider 没真流**
   - [backend/services/model_service.py:376-385](backend/src/allhands/services/model_service.py#L376) `_build_openai_body(..., stream=True)` — 确认 `_build_openai_body` 真的写进了 `"stream": true`
   - 某些 provider(阿里百炼 / 某些 compat endpoint)需要 `stream_options.include_usage=True` · 或返回非标准 chunk 格式导致 `aiter_lines` 等到完整 body
3. **前端 onToken 批量更新**
   - [web/components/gateway/ModelTestDialog.tsx:120-130](web/components/gateway/ModelTestDialog.tsx#L120) React 18 自动 batch `setState`。如果 delta 很密,React 可能合并到下一 tick。通常仍有逐帧视觉,但极端情况下看起来像一次性
4. **Transfer-Encoding / buffering header 被上游剥掉**
   - 某些反向代理(Cloudflare / Nginx / Next middleware)会缓冲直到 KB 阈值。backend 已设 `X-Accel-Buffering: no`,但 Next rewrites 可能重写 headers

## 诊断步骤(track 先做这些,**不要上来就改代码**)

1. 启 backend + web · 按 repro 复现 · 开 Chrome DevTools → Network → 勾 Fetch/XHR · 看 `/api/models/<id>/test/stream` 的 **Response 面板**:
   - 有没有 EventStream 视图(Chrome 只在 `text/event-stream` 真流时显示)
   - Time waterfall 里 TTFB 是否 > 整段延迟 — 如果是,说明 backend 已经在等整段
2. `curl -N -X POST http://localhost:8000/api/...`(直连 backend 8000)vs `curl -N ... :3000/api/...`(走 Next 代理)· 对比是否一致
3. 如果 backend 直连也不流 → 查 provider 层 + `_build_openai_body`
4. 如果 backend 直连流、Next 代理不流 → 确诊 Next rewrites buffering · 解决:把 SSE 端点改成 Next `route.ts` 手动 pipe ReadableStream,或者前端直连 `NEXT_PUBLIC_BACKEND_ORIGIN` 绕过 rewrites

## 修复 DoD

- 模型对话测试里 delta 必须逐帧可见(Playwright e2e 断言:在总响应时间的 30% 之前至少有 3 个 state.ttft 更新样本)
- Backend 侧加 `test_model_service_stream_chunking.py`:fake upstream 吐 10 个 chunk,端到端验证 backend 每个 chunk 都触发一次 `yield`(不吞)
- 前端 `ModelTestDialog` vitest 加 `test: delta accrues incrementally, not batch`:注入 10 帧 SSE,断言 `streamContent` 中间状态至少被观察到 5 次 distinct values
- 修复路径依据诊断步骤的结论,**先定位再修**
- 与 I-0017 合并 track 推进 · AG-UI 迁移会影响修复方式
