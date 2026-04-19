# allhands · Open Issues Index

> 只列 `status ∈ {open, in-progress, blocked}` 的 issue。
> `closed` 的在 `closed/` 目录 · 不再出现在此表。
> **新建 / 关闭 issue 必须同步更新本表。**

最后更新:2026-04-19(track-2-qa audit + user product review I-0015/I-0016)

---

## 现役清单

| ID | Severity | Status | Title | Affects | Discovered | Blocker-for | Tags |
|---|---|---|---|---|---|---|---|
| [I-0002](open/I-0002-model-context-window-zero.md) | P2 | open | `qwen3.6-plus` context_window=0 · 前端显示异常 / Agent token 预算失效 | backend(models seed) + web(settings) | 2026-04-18 / api-probe | — | backend, data |
| [I-0003](open/I-0003-provider-default-model-dangling.md) | P2 | open | Provider `百炼` default_model=`glm-5` · 但库里只有 `qwen3.6-plus` · 悬空引用 | backend(providers seed) | 2026-04-18 / api-probe | — | backend, data |
| [I-0006](open/I-0006-cockpit-frontend-polling-not-sse.md) | P0 | open | Cockpit frontend polls every 5s instead of consuming the SSE stream | web/components/cockpit | 2026-04-19 / track-2-qa | cockpit DoD | ui, api, perf |
| [I-0007](open/I-0007-state-components-missing.md) | P0 | open | Shared state components (EmptyState / ErrorState / LoadingState / FirstRun) never built | web/components/** | 2026-04-19 / track-2-qa | visual-upgrade DoD, self-review R3, walkthrough N6 | ui, visual |
| [I-0008](open/I-0008-employee-card-render-component-missing.md) | P1 | open | EmployeeCard render component not registered — create_employee result cannot render in chat | web/lib/component-registry · employee_tools | 2026-04-19 / track-2-qa walkthrough W2 | walkthrough W2 (N1) | ui, render-tools |
| [I-0009](open/I-0009-architecture-doc-drift.md) | P1 | open | product/04-architecture.md never updated for triggers L5.9 + cockpit L7.1/L8.1 | product/04-architecture.md | 2026-04-19 / track-2-qa | L01 discoverability | docs, backend |
| [I-0010](open/I-0010-raw-state-literals-no-lint-rule.md) | P1 | open | Raw "Loading…" / "Error" / "No data" literals across app · no ESLint rule enforces | web/** | 2026-04-19 / track-2-qa | visual-upgrade DoD | ui, visual, lint |
| [I-0011](open/I-0011-missing-integration-e2e-tests.md) | P1 | open | Missing integration / e2e tests across 5 delivered specs | backend/tests/integration · web/tests/e2e | 2026-04-19 / track-2-qa | self-review R2, Wave 2 regression safety | backend, ui, tests |
| [I-0012](open/I-0012-design-lab-missing-live-samples.md) | P2 | open | design-lab missing live samples for Viz components + Artifact.Preview | web/app/design-lab | 2026-04-19 / track-2-qa | — | ui, visual, docs |
| [I-0013](open/I-0013-voice-tone-chapter-and-lead-welcome-missing.md) | P2 | open | Voice & Tone chapter + Lead welcome message never added | product/03-visual-design · employee_service | 2026-04-19 / track-2-qa | — | docs, ui |
| [I-0014](open/I-0014-coachmark-firstrun-guide-missing.md) | P2 | open | Coachmark system + first-run guided tour not built | web/components/ui · lib/first-run | 2026-04-19 / track-2-qa | — | ui, onboarding |
| [I-0015](open/I-0015-composer-ergonomics-ai-native.md) | P0 | open | Composer 布局不符合 AI 原生产品惯例 · thinking 位置错 · 中止按钮缺失 | web/components/chat · /models · 所有对话入口 | 2026-04-19 / user-product-review | AI-native UX DoD | ui, ux, product-quality |
| [I-0016](open/I-0016-streaming-output-universal.md) | P0 | open | 流式输出(打字机)没有覆盖所有 AI 输出位置 · 非 AI 原生体验 | web/lib/stream-client · MessageBubble · 所有 agent 消费点 | 2026-04-19 / user-product-review | AI-native UX DoD | ui, api, streaming |

---

## 分布

| 维度 | 数量 |
|---|---|
| P0 | 4 |
| P1 | 4 |
| P2 | 5 |
| **open** | 13 |
| **in-progress** | 0 |
| **blocked** | 0 |

---

## 使用说明

**执行端 Claude** · 在以下时机扫本表(细则见 [`docs/claude/bug-fix-protocol.md`](../claude/bug-fix-protocol.md)):

1. **每个 task commit 前** · 若 P0 清单非空 → 必须先修 P0
2. **每天第一个 commit 前** · 若 P1 清单非空 → 当日至少清 1 条
3. **关闭 plan 前** · P0 / P1 清单必须全空

**发现新 bug 的流程:**

1. `cp docs/issues/TEMPLATE.md docs/issues/open/I-<NNNN>-<slug>.md`
2. 填正文(repro + expected + actual + evidence)
3. 追加到本表末尾
4. commit:`docs(issues): I-<NNNN> <一句话>`

**关闭 issue 的流程:**

1. 修复代码 + 回归测试 · commit
2. issue 末尾追 `## 关闭记录` · 填 sha + 测试名
3. `mv open/I-<NNNN>-*.md closed/`
4. 本表里**删掉该行**(closed 不在本表露出)
5. commit:`fix(I-<NNNN>): <一句话> + 回归测试 <test_name>`

---

## 历史

- 2026-04-18 · 初建 · 录入 I-0001(E04 chunks blank)· I-0002(context_window=0)· I-0003(default_model 悬空)
- 2026-04-19 · 关闭 I-0001(E04 复发实例 · track-1 拾起 · dev 冷启 + routes-smoke 31/31 绿)
- 2026-04-19 · track-2-qa 审计 7 份交付 spec · 新增 I-0005…I-0014(3 P0 / 4 P1 / 3 P2)
- 2026-04-19 · 关闭 I-0005(track-A fix-artifacts-sse · ArtifactChangedEvent + bus 广播 + /api/artifacts/stream + tests/integration/test_artifacts_sse.py)
