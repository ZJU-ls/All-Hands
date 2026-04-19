---
id: I-0018
title: `/gateway` 模型测试 · 字符一次性蹦出而非逐帧流 · 前端看不见打字机效果
severity: P0
status: closed
discovered_at: 2026-04-19
discovered_by: user
closed_at: 2026-04-19
closed_by: track-j
affects: web/components/gateway/ModelTestDialog · web/lib/stream-client · backend/services/model_service
reproducible: true
blocker_for: I-0017(AG-UI 迁移需先确定 streaming 基线正确)
tags: [ui, backend, perf, streaming]
---

# I-0018 · 模型对话测试 · 字符一次性蹦出

## Repro

1. `docker compose up`(或 `uv run uvicorn allhands.main:app --reload --port 8000` + `pnpm dev`)
2. 打开 http://localhost:3000/gateway
3. 任选一个 `enabled=true` 的 model(例 `百炼 / qwen3.6-plus`)· 点"测试"
4. 输入"数 1 到 10" · ↵ 发送
5. 观察 assistant 气泡的文本增长方式

## Expected

- 文本按 token 逐字出现 · 类似 ChatGPT / Claude 的打字机效果
- 光标 `▍` 可见 · 每 30-100ms 刷新一次 · TTFT 卡片能被观察到中间过渡

## Actual

- 等 2-5 秒 · 整句(或整段)一次性出现
- 没有中间过渡 · 看起来像非流式返回(但 TTFT / tok/s 卡片最终会出数据,说明 `done` frame 有到)

## Evidence

### 1. Next rewrites 不是罪魁(2026-04-19 实验)

用 `/tmp/fake_sse.py`(FastAPI · drip 10 帧 · 每帧 200ms)隔离:

- `curl -sN http://127.0.0.1:8019/api/sse/drip` 直连 · 帧时间戳 `0, 200, 400, 600, 800, 1000, …, 2000ms` · 完美 drip
- `curl -sN http://127.0.0.1:3009/api/sse/drip`(Next 15.0.3 `rewrites()` 代理到 8019)· 帧时间戳 `0, 205, 407, 608, …, 2011ms` · 每帧 ≈+5ms 开销 · drip 保留

响应头在两条路径上都带:
```
x-accel-buffering: no
transfer-encoding: chunked
content-type: text/event-stream; charset=utf-8
```

→ **`rewrites()` 没有 SSE buffering,这个曾被列为头号嫌疑的假设证伪。**

### 2. FastAPI `StreamingResponse` 本身也不是罪魁

同一 fake endpoint 用的就是 `StreamingResponse(_gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})` — 与 `test_model_stream` 的生产实现 **一模一样**。drip 得了出来,证明这条机制 OK。

### 3. 代码结构审查 · 剩余可疑路径

| 位置 | 证据 | 判定 |
|---|---|---|
| `model_service.astream_chat_test` `aiter_lines()` | httpx 的 `aiter_lines` 按 `\n` 逐行 yield;但 **chunk 边界来自上游 TCP**,若上游一次发多行,它们会在一个 microtask 里连发 | 中度可疑 · 依赖上游 |
| `_build_openai_body` | 已写 `"stream": true` + `"stream_options": {"include_usage": True}` · 参数面无误 | 结构 OK · 无法判断上游是否真遵循 |
| `stream-client.ts` WHILE 循环(line 108-124) | `while ((sepIdx = buffer.indexOf("\n\n")) !== -1) { … callbacks.onToken?.(delta, frame); }` · **一个 `reader.read()` 里所有帧都同步刷完 · 无 await** | **高度可疑 · React 18 automatic batching 会把连续 setState 合并成一次 paint** |
| `ModelTestDialog.runStreaming::onToken` | 直接 `setStreamContent(acc)` · 无 `flushSync` / `startTransition` | 配合 H2 → 一次 paint 消化多帧 |

### 4. 关键 ModelTestDialog UX

`max_tokens` 默认 **512**(`DEFAULT_PARAMS.max_tokens = 512`)· 但用户测试常用短问(例 "数 1 到 10" · 输出 20-40 字)· 短输出 + 快上游 → 很可能整段响应落在一个 TCP 包里。

## 根因分析(推断 · 待用户验证)

两个叠加的问题:

### H1 · 上游 provider batching(HIGH · 未验证)

百炼/DashScope 的 OpenAI-compat `/v1/chat/completions` endpoint 对小响应会把多个 delta 合并成一个 HTTP chunk · 即便 `stream=true` 也如此。结果:backend 收到的是"假流"(一次拿到 10 帧)· `aiter_lines` 按 `\n` 分 10 个 yield · 但全在一个 microtask 里 · uvicorn 连续 10 个 body event 合并成一个 TCP 写 · 前端一个 `reader.read()` 全拿到。

### H2 · 前端 synchronous batching(MEDIUM · 总是存在的隐患)

即便 H1 解决,`stream-client.ts` 的内层 WHILE 循环把一次 `reader.read()` 产出的所有帧同步消化 · 连续 N 次 `setStreamContent` · React 18 automatic batching 合并成一次 paint。对于任何 "frames arrive within one network read" 场景都会"一次性蹦出"。

## 建议修法(候选 · 决定权在用户)

### A · 前端防御修(推荐 · 不依赖 provider 行为)

在 `stream-client.ts` 内层 WHILE 循环每帧末尾 `await` 让出事件循环:

```ts
while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
  // … existing logic …
  await new Promise<void>((r) => setTimeout(r, 0));  // yield → browser paint
}
```

或用 `flushSync` 包裹 `onToken` 回调 · 或让 consumer 改用 `startTransition` + 双缓冲。

**优点:**修一处 · 不依赖上游 · chat / 将来 AG-UI 也直接受益。
**缺点:**每帧多 ~1ms · 1000 帧 = 1s 额外开销(可忽略)。

### B · 合并做 AG-UI 迁移(I-0017)

AG-UI 的 `TEXT_MESSAGE_CONTENT` 语义明确是 per-token delta · 迁移时把 stream-client 和 model-test 同步改成**每帧一个 microtask yield** · 顺便修 H2。

**优点:**一次做两件事 · 同一次 PR。
**缺点:**I-0017 设计 + 实现需要时间,I-0018 没法立刻上线热修。

### C · 仅加诊断 · 不动实现

临时加一个 `?debug=1` 或 console.log 打桩 · 让用户在真实 provider 上跑一次 · 拿到实际 per-frame 时间戳 · 再决定 A/B。

**优点:**决策最稳。
**缺点:**多一次来回。

## 推荐

> 先 **跑一次真实 provider 的 curl 抓 wire 时间戳** 让 H1 水落石出,然后走 A(前端防御)。AG-UI 迁移保持独立 track 推进 · 只是在 I-0017 实现里复用同一个"WHILE 循环每帧 microtask yield"修法。

真实 provider curl 一条 · 用户可自行执行:

```bash
curl -sN -v -m 10 \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"数 1 到 10"}],"max_tokens":64}' \
  http://localhost:8000/api/models/$MODEL_ID/test/stream \
  | python3 -c '
import sys, time
t0=None
for raw in sys.stdin.buffer:
    now=time.perf_counter()
    if t0 is None: t0=now
    line=raw.decode("utf-8","replace").rstrip("\n")
    if line: print(f"+{int((now-t0)*1000):>5}ms  {line}"); sys.stdout.flush()
'
```

若所有 `event: delta` 都在 +0-20ms 窗口内 → H1 成立。
若 `event: delta` 间距 30-100ms → H1 不成立 · 纯 H2 · A 修法 100% 足够。

## 验收标准

- [ ] `web/lib/__tests__/stream-client.test.ts` 新增用例:一个 `reader.read()` 返回 10 帧 · 断言 `onToken` 之间有 microtask 间隙 · 不全在同一同步栈里
- [ ] `web/components/gateway/__tests__/ModelTestDialog.test.tsx` 新增用例:注入 10 帧 SSE · 断言 `streamContent` 至少观察到 5 个 distinct values(证实每帧触发一次 paint)
- [ ] `backend/tests/integration/test_model_service_stream_chunking.py`:httpx `MockTransport` 吐 10 chunk · 断言 `astream_chat_test` 每 chunk yield 一次(防御 H3 回归)
- [ ] `web/tests/e2e/model-test-streaming.spec.ts`:playwright 截 10 帧 fake SSE · 断言 UI 中 `streamContent` 的中间态 distinct count ≥ 5
- [ ] 用户手动回归:真实 provider `数 1 到 10` · 能看到打字机效果

## 相关

- 错误模式(新增):React 18 automatic batching × SSE 同步消化 = 看似不流
- 学习(新增):Next 15 `rewrites()` 对 SSE 透明 · 不再视为默认嫌疑
- 前序 issue:I-0016(Track D 落地的 stream-client + 打字机 · 未覆盖 "frames clumped in one read" 场景)
- 关联:I-0017 AG-UI 迁移(共享同一 stream-client,共享同一修法)

---

## 工作记录

### 2026-04-19 · in-progress · track-j
- 阶段 1 · 隔离实验完成:Next rewrites **证伪** · FastAPI StreamingResponse **证伪**
- 剩余两个假设(H1 上游 batching · H2 前端 batching)· H2 可独立修 · H1 需 live provider 数据才能定性
- 诊断报告 `docs/tracks/J-diagnosis.md` · 待用户确认走哪条路
- 下一步:等用户决定 A / B / C · 预计走 A + 补 wire 日志

---

## 关闭记录

**2026-04-19 · track-j · 关闭**

- 根因定性:**H2 前端 React 18 automatic batching**(H1 上游 batching 是可能的放大器,但 H2 一旦修好,H1 也不再产生症状;H1 在 provider 侧无法强改,且本次修复使前端对 H1 不再敏感)
- 修复:`602d310` 诊断 + issue 登记 · `0d23ba5` `stream-client.ts` 加 macrotask yield · `3f519db` 两条回归测试
- 回归测试:
  - `web/lib/__tests__/stream-client.test.ts::spreads onToken across macrotasks when frames arrive in one chunk (I-0018)` — 5 帧打包到一个 ReadableStream chunk · 用 `setTimeout(0)` marker 分区 token · 断言 ≥1 个 token 落在 marker 之后
  - `web/tests/e2e/model-test-streaming.spec.ts::ModelTestDialog · typewriter with one-chunk SSE (I-0018)` — Playwright page-level fetch mock · MutationObserver 捕获 assistant bubble textContent · 10 帧打包到一个 chunk · 断言 ≥5 个 distinct 中间态
- `./scripts/check.sh` 全绿(976 vitest · 783 pytest)
- 受益面:**同一 stream-client 被 chat / cockpit / artifacts / model-test 四路 SSE 消费者共享**,一次修复全链路受益;AG-UI 迁移(I-0017)无需重做此修
