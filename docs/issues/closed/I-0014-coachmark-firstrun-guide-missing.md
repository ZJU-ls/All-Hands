---
id: I-0014
title: Coachmark system + first-run guided tour not built
severity: P2
status: open
discovered_at: 2026-04-19
discovered_by: track-2-qa audit
affects: web/components/** (no Coachmark / FirstRun primitives)
reproducible: true
tags: [ui, onboarding]
---

# I-0014 · Coachmark + first-run tour missing

## Repro

1. `rg -l Coachmark web/components` → 0
2. `rg -n 'firstRunSeen|coachmarkSeen' web/` → 0
3. Open `/` as a fresh user (empty DB) — no guided tour; user is left to guess where to start.

## Expected

`2026-04-18-visual-upgrade.md § 5.2` calls for a lightweight `<Coachmark>` primitive (dismissable, state persisted in localStorage with keys like `coachmark:seen:<id>`). First-run on cockpit should drop 3 coachmarks on the primary CTAs.

## Actual

Nothing exists. New users face a blank cockpit and no guidance.

## Suggested fix

1. `web/components/ui/Coachmark.tsx` — token-based, no animation library.
2. `web/lib/first-run.ts` — persistence helpers.
3. Seed 3 coachmarks in `Cockpit.tsx` for the first-run path (guarded by FirstRun of I-0007).

## Acceptance criteria

- [ ] Coachmark primitive + helpers ship with unit tests for persistence semantics
- [ ] 3 first-run coachmarks on cockpit; E2E test: appear on first visit, never on second

## Related

- depends on I-0007 (FirstRun host surface)
- spec: `2026-04-18-visual-upgrade.md § 5.2`

## 关闭记录

- **2026-04-20** · 修复提交 pending · 回归测试:
  - `backend/tests/unit/test_model_service_validation.py` (I-0002 · ModelConfigError + service-boundary ctx_window > 0)
  - `backend/tests/unit/test_gateway_seeds.py::test_gateway_seed_every_model_has_positive_context_window` (seed 数据回归)
  - `backend/tests/unit/test_model_service_validation.py::test_set_default_model_*` (I-0003 · ProviderConfigError + cross-check enabled model)
  - `backend/tests/unit/test_gateway_seeds.py::test_gateway_seed_default_model_points_to_existing_model` (seed 数据回归)
  - `web/tests/render-library-coverage.test.ts` 14 用例 · design-lab 静态扫 MarkdownCard / PlanTimeline / PlanCard / Artifact.Preview 活样本存在 (I-0012)
  - `backend/tests/unit/test_lead_welcome.py` 6 用例 · Lead prompt 含 "Welcome message" 节 + `欢迎` + ≥3 条示例 + Style 节 voice rules (I-0013)
  - `web/tests/voice-tone.test.ts` 4 用例 · 扫 `web/app/**` + `web/components/**` 的 emoji / `!` / `咱们` / 按钮文案 (I-0013)
  - `web/tests/first-run.test.ts` 8 用例 · localStorage 持久化语义 (I-0014)
  - `web/tests/coachmark.test.tsx` 4 用例 · Coachmark 首次显示 / dismiss / 再访不显示 (I-0014)
- **同步修改**:
  - `product/03-visual-design.md §9.1` 新增 Voice & Tone 章 (I-0013)
  - `design-system/MASTER.md §6.5` 新增 Voice & Tone 速查表 (I-0013)
  - `backend/src/allhands/execution/prompts/lead_agent.md` 新增 Welcome message + 扩 Style / Voice & Tone 节 (I-0013)
  - `web/lib/first-run.ts` + `web/components/ui/Coachmark.tsx` 新建 · `Cockpit.tsx` 埋 3 条 coachmark (I-0014)
  - `web/vitest.setup.ts` 加 localStorage shim 绕开 Node 25 built-in 拦截
