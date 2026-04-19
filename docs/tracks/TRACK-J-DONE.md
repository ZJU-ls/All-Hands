# Track J · DONE

**Issue:** [I-0017](../issues/open/I-0017-ag-ui-protocol-migration.md) · P1 · 全链路迁移到 AG-UI Protocol v1
**ADR:** [0010 · adopt AG-UI Protocol](../../product/adr/0010-ag-ui-protocol-adoption.md)
**Branch:** `ag-ui-migration-and-stream-fix`
**Worktree:** `/Volumes/Storage/code/allhands-track-d`
**HEAD:** 待下一个 commit 写入

---

## 背景

I-0018 在 track-j 分支上先落地(stream-client 在一个 reader chunk 含 ≥2 帧时不 yield
macrotask → React 自动批处理把 10 个 setState 合并成一次绘制 → 打字机"蹦一次"),修复
思路是"每帧 setTimeout(0)"。这迫使我们把 `stream-client.ts` 完整审一遍,顺势发现
四个 SSE 端点各自发明了线格式(legacy `event: token / delta / done / snapshot /
activity / artifact_changed / ready / meta / done / error`),前端也有两套 ad-hoc parser
(fetch-ReadableStream 版 + EventSource 版),protocol schema 在前后端之间
人肉同步。ADR 0010 决定:**一次性切 AG-UI Protocol v1,不留长尾兼容**。

---

## 交付一览

| Phase | 内容 |
|---|---|
| 0 | ADR 0010 落地 + I-0017 issue + track-j 诊断报告(前置 commits) |
| 1 | `ag_ui_encoder` 模块:16 个 v1 事件类型 · camelCase 序列化别名 · `encode_sse()` helper |
| 2 | 后端 4 端点同时迁移:chat / model-test / cockpit / artifacts |
| 3 | `stream-client.ts` 重写为 AG-UI v1 parser · 11 个 typed 回调 + `onCustom` + `onEvent` 回退 |
| 4 | 4 个 web 消费者切到语义钩子:InputBar / ModelTestDialog / Cockpit / ArtifactPanel |
| 5 | 前后端回归测试全切 v1 wire format · e2e 两本 spec 换新帧语法 |

---

## 关键文件

**新增:**
- `backend/src/allhands/api/ag_ui_encoder.py` · v1 事件工厂 + `encode_sse()` · camelCase
- `backend/tests/integration/test_ag_ui_wire_format.py` · 4 端点 wire format TDD 守护
- `docs/tracks/J-diagnosis.md` · I-0018 根因分析 + AG-UI 切换动议
- `product/adr/0010-ag-ui-protocol-adoption.md` · 架构决策

**后端改:**
- `backend/src/allhands/api/routers/chat.py` · RUN_STARTED/TEXT_MESSAGE_*/TOOL_CALL_*/CUSTOM/RUN_FINISHED
  替换 `event: token / tool_call_* / confirm_required / render / nested_run_* / trace / done / error`
- `backend/src/allhands/api/routers/models.py`(model-test/stream)· TEXT_MESSAGE_CHUNK · REASONING_MESSAGE_CHUNK · CUSTOM(allhands.model_test_metrics / allhands.model_test_error)
- `backend/src/allhands/api/routers/cockpit.py` · CUSTOM(allhands.cockpit_snapshot / cockpit_activity / cockpit_run_update / cockpit_run_done / cockpit_health / cockpit_kpi)· heartbeat
- `backend/src/allhands/api/routers/artifacts.py` · CUSTOM(allhands.artifacts_ready / allhands.artifact_changed)· heartbeat
- `backend/src/allhands/execution/events.py` · 去掉 TYPE_CHECKING 护栏(execution → core 已在 lint-imports 允许),修 PydanticUserError

**前端改:**
- `web/lib/stream-client.ts` · 整体重写(260 行)· `openStream()` 返回 `{abort, done}` · dispatchFrame switch · I-0018 macrotask yield 保留
- `web/lib/__tests__/stream-client.test.ts` · 13 个 AG-UI 用例(lifecycle · reasoning split · tool call · RUN_ERROR · HTTP 500 · 外部 AbortSignal · step · I-0018 回归)
- `web/components/chat/InputBar.tsx` · `onTextMessageStart / onTextMessageContent / onToolCall* / onCustom(allhands.confirm_required / allhands.render) / onRunError / onRunFinished`
- `web/components/gateway/ModelTestDialog.tsx` · `onTextMessageChunk / onReasoningMessageChunk / onCustom(allhands.model_test_metrics / allhands.model_test_error) / onRunError`
- `web/components/cockpit/Cockpit.tsx` · `addEventListener("CUSTOM", …)` · 按 `data.name` 分发 snapshot/activity/heartbeat/run_update/run_done/health/kpi
- `web/components/artifacts/ArtifactPanel.tsx` · CUSTOM 分发 artifacts_ready / artifact_changed / heartbeat

**测试改(全部仍绿):**
- `backend/tests/integration/events/test_event_projection.py` · `_KIND_TO_CUSTOM_NAME` 导入 + 断言 `allhands.cockpit_*`
- `backend/tests/integration/test_artifacts_sse.py` · 断 RUN_STARTED + CUSTOM(allhands.artifact_changed)
- `backend/tests/integration/test_chat_cancel.py` · 断首帧 RUN_STARTED、次帧 TEXT_MESSAGE_START
- `backend/tests/integration/test_cockpit_api.py` · 骨骼(已 skip)的断言更新到 v1(留给未来 async rewrite)
- `web/components/cockpit/__tests__/cockpit-sse.test.tsx` · emit CUSTOM 信封
- `web/components/artifacts/__tests__/artifact-panel-sse.test.tsx` · 同上
- `web/tests/e2e/chat-ux.spec.ts` · 帧语法切到 TEXT_MESSAGE_START + TEXT_MESSAGE_CONTENT + RUN_FINISHED
- `web/tests/e2e/model-test-streaming.spec.ts` · TEXT_MESSAGE_CHUNK × 10 · CUSTOM(allhands.model_test_metrics)

---

## 验收 DoD(对齐 I-0017 §验收)

- [x] **4 个 SSE 端点一并切 v1**:chat · model-test · cockpit · artifacts
- [x] 所有 v1 wire 字段 camelCase(`threadId / runId / messageId / toolCallId / toolCallName / stepName`)· 私有扩展全部走 `CUSTOM { name: "allhands.*", value: snake_case_payload }`
- [x] `stream-client.ts` 暴露 AG-UI 语义钩子 + `onCustom` + `onEvent` 回退 + 保留 AbortSignal + I-0018 macrotask yield
- [x] 前端 4 消费者全部走新钩子 · 无 token/meta/delta 等 legacy 字样残留
- [x] 回归测试全绿:
  - `backend pytest` 846 passed · 1 skipped(TestClient+aiosqlite+SSE 死锁 · 非本次引入)· 2 xfailed
  - `web vitest` 997 passed · 43 skipped(routes-smoke)
  - `stream-client.test.ts` 13/13
  - cockpit-sse + artifact-panel-sse 回归在新 CUSTOM 信封下绿
- [x] `ruff check` / `ruff format --check` / `mypy src` / `lint-imports` / `eslint` / `tsc --noEmit` / self-review / walkthrough-acceptance 全绿
- [x] `./scripts/check.sh` 全绿(最后一次运行打印 `All checks passed.`)
- [x] **不留长尾兼容**:后端不同时发 legacy + v1 · 前端不同时解析两套 · 测试不走旧协议

---

## I-0018 关系

I-0018(model-test 打字机蹦一次)在 track-j 分支早期 commit 里已经修过一次
(`9960c9f fix(stream): yield macrotask between SSE frames`)· 这次迁移保留了同样
的 `await new Promise(r => setTimeout(r, 0))` · e2e 用 10 帧打包成一个 chunk 的
pathological case 验证 ≥5 distinct intermediate paints。相当于 I-0018 修复在 AG-UI
协议上也被 regression-guarded。

---

## 留给后续(不阻断关闭)

- `test_cockpit_api.py::test_stream_first_frame_is_snapshot` 仍 skip(TestClient + aiosqlite + SSE 死锁)· 断言已经更新到 v1 · 等重写为 `httpx.AsyncClient` 或 e2e 时即可解 skip
- AG-UI v1 规范未来加新事件(STATE_DELTA 等)时,`stream-client.ts` 的 `onEvent` 回退可以先兜住,逐步补类型化钩子
- Legacy `event: error` 在 backend Model Test 路径上还通过 CUSTOM `allhands.model_test_error` 保留了 `error_category / latency_ms` 字段 — 这是**协议外的业务 meta**,非 v1 事件语义,属于允许的 CUSTOM 扩展(见 ADR 0010 §"长尾兼容"条款的一个反例解释)

---

## L01 自证(Tool First · 保留)

本次迁移纯协议层,不新增或删除任何 REST / Meta Tool 配对 · `TestL01ToolFirstBoundary`
持续绿 · 边界契约未触。
