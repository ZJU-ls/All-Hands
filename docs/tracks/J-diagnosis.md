# Track J · I-0018 诊断报告

> 2026-04-19 · worktree `allhands-track-d` · branch `ag-ui-migration-and-stream-fix`
> 阶段 1 产物 · 用户确认后才进阶段 2。

---

## 1. 问题重述

`/gateway` → 选 model → "测试" dialog · 发消息后 assistant 回复**一次性出现**,没有逐字流式 / 打字机效果。

- TTFT / tok/s 卡片最终能出数据 → `event: done` 到了 → 后端有在传
- 但用户等 2-5 秒 · 整段文字同时显现 · 中间没有 UI 过渡

## 2. 实验(证伪 / 证实)

### 2.1 隔离实验:Next.js `rewrites()` 是否 buffer SSE?

工具:
- `/tmp/fake_sse.py` · 一个 30 行 FastAPI · 提供 `GET /api/sse/drip` · 生成 10 帧 delta · 每帧 `await asyncio.sleep(0.2)` · 带 `Cache-Control: no-cache` + `X-Accel-Buffering: no`
- `/tmp/sse_stamp.sh` · curl -sN -i · python3 读字节 · 每行打相对首字节的 ms 时间戳

步骤:
1. `python /tmp/fake_sse.py` (port 8019)
2. `BACKEND_ORIGIN=http://127.0.0.1:8019 pnpm exec next dev --port 3009`
3. `/tmp/sse_stamp.sh http://127.0.0.1:8019/api/sse/drip` · 直连
4. `/tmp/sse_stamp.sh http://127.0.0.1:3009/api/sse/drip` · 过 Next rewrites

**结果:**

直连 baseline:
```
+    0ms  event: meta      data: {"started_at": 238495.03}
+  161ms  event: delta     data: {"i": 0, "elapsed_ms": 200}
+  363ms  event: delta     data: {"i": 1, "elapsed_ms": 402}
+  563ms  event: delta     data: {"i": 2, "elapsed_ms": 602}
+  764ms  event: delta     data: {"i": 3, "elapsed_ms": 803}
…
+ 1965ms  event: delta     data: {"i": 9, "elapsed_ms": 2003}
+ 1965ms  event: done
```

Next rewrites 代理:
```
+    0ms  event: meta      data: {"started_at": 238537.19}
+  165ms  event: delta     data: {"i": 0, "elapsed_ms": 201}
+  367ms  event: delta     data: {"i": 1, "elapsed_ms": 402}
+  568ms  event: delta     data: {"i": 2, "elapsed_ms": 604}
…
+ 1976ms  event: delta     data: {"i": 9, "elapsed_ms": 2011}
+ 1976ms  event: done
```

两条路径帧间距几乎相同(±5ms)· Next 对每帧仅加 ~5ms 开销 · **drip 完整保留**。响应头两边都有 `x-accel-buffering: no` + `transfer-encoding: chunked`。

**结论:Next.js 15.0.3 `rewrites()` 对 SSE 透明,此前的头号假设证伪。**

### 2.2 FastAPI `StreamingResponse` 本身

fake endpoint 的实现与生产 `test_model_stream` 一模一样(`StreamingResponse(_gen(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})`)· drip 得了出来 → **FastAPI + uvicorn 这条路径也不是罪魁**。

### 2.3 Backend 路径结构化审查

`backend/src/allhands/services/model_service.py::astream_chat_test`:
- `client.stream("POST", url, …)` · httpx async · OK
- `async for line in resp.aiter_lines():` · **每行 yield 一次 · 但 chunk 边界来自上游 TCP**
- `yield {"type": "delta", "text": str(c)}` · 每 delta 一次 yield
- `_build_openai_body` 写 `"stream": true` + `"stream_options": {"include_usage": True}` · 参数面无误

`backend/src/allhands/api/routers/models.py::test_model_stream`:
- `async for evt in astream_chat_test(…)` → `yield f"event: {event}\ndata: {json}\n\n".encode()` · 每 evt 一次 yield
- `StreamingResponse(_sse(), media_type="text/event-stream", headers={..., "X-Accel-Buffering": "no"})` · OK
- **无 GZip/compression middleware**(app factory 只加了 CORSMiddleware)
- 无 response buffering flag

→ **Backend 结构本身没有明显 bug。但 upstream 若把多行 SSE 打包进一个 TCP chunk,`aiter_lines` 会在一个 microtask 里连续 yield 多行。**

### 2.4 Frontend 路径结构化审查

`web/lib/stream-client.ts` 内层 WHILE(line 108-124):

```ts
while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
  const rawFrame = buffer.slice(0, sepIdx);
  buffer = buffer.slice(sepIdx + 2);
  const frame = parseSseFrame(rawFrame);
  if (!frame) continue;
  const tokenField = tokenEvents[frame.event];
  if (tokenField) {
    const delta = frame.data[tokenField];
    if (typeof delta === "string" && delta.length > 0) {
      callbacks.onToken?.(delta, frame);  // ← 同步调用 consumer
    }
    callbacks.onMetaEvent?.(frame);
  } else {
    callbacks.onMetaEvent?.(frame);
  }
}
```

**关键:一个 `reader.read()` 里所有帧都同步刷完 · 两帧之间没有 await。**

`ModelTestDialog.runStreaming::onToken` 里就 `setStreamContent(acc)` · 无 `flushSync` / 无 `startTransition`。

React 18 的 automatic batching 会把 **同一同步栈里的多次 setState 合并成一次 render** · 所以如果 10 帧在一个 `reader.read()` 里 · 用户只会看到一次 paint(最后一帧之后)· 看起来就是"一次性蹦出"。

## 3. 结论

**根因两层叠加,按可能性排:**

### H1 · 上游 provider batching(HIGH 可能 · 未拿到 live 数据)

百炼/DashScope 的 OpenAI-compat `/v1/chat/completions` 对短响应(用户常用例 "数 1 到 10"· 输出 ≤ 64 tokens)常把多帧合并成一个 TCP chunk 下发 · 尽管设置了 `stream: true`。这会导致:
- httpx `aiter_lines` 一次 microtask 连续 yield 10 行
- backend 的 `_sse()` 生成器一次连续 yield 10 个 SSE 帧
- uvicorn 合并成一个 body write
- Next rewrites 忠实转发(上面已证伪 "Next buffer" 假设,但它**透传 upstream 的块结构**)
- Frontend 一个 `reader.read()` 拿到 10 帧
- stream-client WHILE 循环同步刷完 · 10 次 `setStreamContent` → React 合并成一次 paint

### H2 · React 18 automatic batching(MEDIUM · 永远存在的隐患)

即便 H1 不存在(上游纯 drip)· 只要两帧之间间距 < 16ms(60fps paint 间隔)· React 18 的 concurrent mode 仍会把它们合并。chat 路径之所以看起来"更流",是因为 LangGraph 的 token callback 天生每 30-100ms 一个,超过了 paint 间隔。但 model-test 直接消费 OpenAI-compat 流,一旦上游批量发送,立刻触发 H2。

## 4. 修复方案候选

### A · 前端防御 · stream-client 每帧 microtask yield(推荐)

在 WHILE 循环 body 末尾加:

```ts
while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
  // …existing…
  await new Promise<void>((r) => setTimeout(r, 0));  // 让出事件循环 · 让 React paint
}
```

- **优点:**修一处 · 不依赖 provider · chat / AG-UI / 未来所有 SSE 消费者都受益 · 每帧多 ~1ms 可忽略
- **缺点:**语义上对 stream-client 来说是个"打补丁"· AG-UI 迁移时想得再干净点
- **影响面:**`web/lib/stream-client.ts` 单文件 + 一条新 vitest

### B · 合并到 AG-UI 迁移(I-0017)里一起做

把 AG-UI 的 `TEXT_MESSAGE_CONTENT` 消费路径写成"每帧独立 microtask"· 同时引入语义化 hook(`onTextDelta`)· 用 `flushSync` 包裹 setState 触发点(非 consumer 侧,在 stream-client 侧)。

- **优点:**一次 PR 同时修 I-0017 + I-0018 · 不留临时补丁
- **缺点:**I-0018 要等 ADR 过完 + 实现 PR 才能上线 · 拖延"线上 P0 live bug"修复
- **影响面:**stream-client 重写 · 4 条 SSE endpoint 切 encoder · 加起来 ~800-1200 行

### C · 仅加诊断 · 等 live provider 数据再决定

临时加一个 `?debug=1` 路由或 `console.log` 打桩 · 让用户在真实 provider 上测一次 · 收集 per-frame wire 时间戳,再决定 A/B。

- **优点:**决策证据最充分
- **缺点:**一轮额外往返

## 5. 推荐路径

**A + C 并行:**

1. **立刻**:在 `stream-client.ts` 的 WHILE 循环加 `await new Promise(r => setTimeout(r, 0))` · 附带 vitest 新用例(`onToken` 调用之间至少隔一个 microtask)+ 一条 playwright e2e(10 帧 fake SSE · 断言 `streamContent` 至少 5 个 distinct values)。
2. **同时**:让用户跑一次真实 provider curl 抓时间戳(上面有现成命令)· 收集 H1 证据。
3. 如果 H1 被证实 · I-0017 迁移里**不做额外工作**(因为 A 已经把 H2 修了 · H1 在 provider 侧 · 平台没法强改)。如果 H1 证伪 · 验证 A 足够。

### 真实 provider 验证命令(交给用户)

```bash
MODEL_ID=<百炼 的 enabled model id>
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

- 所有 `event: delta` 都在 **+0-20ms 窗口**里 → H1 成立
- `event: delta` 间距 **30-100ms** → H1 不成立 · 只是 H2 · A 修法 100% 够

## 6. 阶段 2 进入条件

**等用户二选一:**

- [ ] 走 A(热修 · 预计 commit ≤ 150 行 · 含测试)· 同时交 C 命令给用户跑一次
- [ ] 走 B(跟 I-0017 合做 · 需先过 ADR)
- [ ] 要先跑 C 拿证据再决定(更稳,多一次回合)

**建议:** A + C 并行(热修 I-0018 不阻塞 AG-UI 设计;同时收集 H1 证据用于 I-0017 写 ADR)。

---

## 附 · 实验代码存档

- `/tmp/fake_sse.py` · FastAPI drip SSE · 30 行 · 已保留在 /tmp · 后续 playwright e2e 可以复用这个 fixture 逻辑
- `/tmp/sse_stamp.sh` · curl + python3 时间戳包装器 · 7 行 · 同上

两者在 `./scripts/check.sh` 绿后会随 Phase 2 的 commit 抄进仓内 `backend/tests/fixtures/fake_sse_upstream.py` + `web/tests/e2e/helpers/sse_stamp.ts`(TS 版),供日后回归。
