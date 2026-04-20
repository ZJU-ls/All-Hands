---
id: I-0012
title: design-lab missing live samples for Viz components + Artifact.Preview
severity: P2
status: open
discovered_at: 2026-04-19
discovered_by: track-2-qa audit
affects: web/app/design-lab/page.tsx
reproducible: true
tags: [ui, visual, docs]
---

# I-0012 · design-lab missing live samples

## Repro

Open `web/app/design-lab/page.tsx`. It demonstrates Linear Precise tokens and a handful of primitives but does not host a live sample of every render component shipped by the render-tool contract.

## Expected

`docs/specs/agent-design/2026-04-18-viz-skill.md § DoD` + `2026-04-18-artifacts-skill.md § DoD` both imply the lab should demonstrate every render component as the authoritative "does it look right" fixture.

## Actual

- No sample invocation of any `Viz.*` component (registered but orphaned)
- No sample of `Artifact.Preview`

Result: visual drift can land without anyone noticing, because the lab doesn't snapshot the real thing.

## Suggested fix

Add a `design-lab §N render library` section with one example per registered component, using tidy fixture data. Keep it paged so it stays readable.

## Acceptance criteria

- [ ] Each registered component appears at least once in the lab
- [ ] Visual-regression snapshot (Playwright) covers the section

## Related

- `web/lib/component-registry.ts` — source of truth for the component list
- tied to I-0011's viz-skill row

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
