---
id: I-0008
title: EmployeeCard render component not registered — create_employee result cannot render in chat
severity: P1
status: closed
discovered_at: 2026-04-19
closed_at: 2026-04-19
discovered_by: track-2-qa walkthrough W2 sign-of-life test
affects: web/lib/component-registry.ts · execution/tools/meta/employee_tools.py
reproducible: true
blocker_for: walkthrough-acceptance W2 (N1 Tool-First redemption)
tags: [ui, render-tools]
---

# I-0008 · EmployeeCard render component not registered

## Repro

1. Open `web/lib/component-registry.ts` — register list:
   `MarkdownCard`, `PlanTimeline`, `Viz.Table`, `Viz.KV`, `Viz.Cards`, `Viz.Timeline`, `Viz.Steps`, `Viz.Code`, `Viz.Diff`, `Viz.Callout`, `Viz.LinkCard`, `Artifact.Preview`.
2. Grep the registry for `Employee` → 0 hits.
3. `backend/tests/acceptance/test_w2_employee.py::test_render_card_for_employee_registered` xfails for this exact reason.

## Expected

The employee-chat spec ships `create_employee` as a Meta Tool so Lead Agent can build employees purely via chat. For the chat surface to reflect the result inline (Tool-First N1 maturity), a render tool must return `{component: "Employee...Card", props: {...}}` and the registry must resolve that string.

## Actual

The meta tool succeeds, DB write lands, but the chat surface has no component to render the new employee inline. The user has to leave `/chat` and open `/employees` to confirm — which violates N1 (Tool-First redemption).

## Evidence

- `web/lib/component-registry.ts` — no Employee*  entry
- `web/components/` has no EmployeeCard / EmployeeList render component (there is `chat/ConversationHeader.tsx` which references employee badges but is not a render-tool target)

## Suggested fix

1. Add `web/components/render/EmployeeCard.tsx` following Linear Precise.
2. Register in `component-registry.ts` as `"Employee.Card"`.
3. Wire `create_employee` tool result to return `{component: "Employee.Card", props: {...employee}}` (or add a dedicated `render_employee_card` tool the Lead can call explicitly).
4. Flip `backend/tests/acceptance/test_w2_employee.py::test_render_card_for_employee_registered` from xfail to hard assert.

## Acceptance criteria

- [x] Component exists + registered
- [x] Design-lab shows a live sample
- [x] test_w2_employee no longer xfails
- [x] Walkthrough-acceptance W2 scores N1=green with evidence

## Related

- spec: `docs/specs/agent-design/2026-04-18-employee-chat.md`
- spec: `docs/specs/agent-design/2026-04-18-walkthrough-acceptance.md W2`
- meta-tool: `backend/src/allhands/execution/tools/meta/employee_tools.py::CREATE_EMPLOYEE_TOOL`

## 关闭记录

- status: closed
- closed_at: 2026-04-19 (Track H)
- fix:
  - `web/components/render/EmployeeCard.tsx` — Linear Precise card: 2 px primary accent bar for active · dot-grid initial avatar (no icon libs) · mono status label · meta line shows `skills`, `tools`, `provider/model`.
  - `web/lib/component-registry.ts` — register `EmployeeCard` alongside `MarkdownCard` / `PlanTimeline` / `Viz.*` / `Artifact.Preview`.
  - `web/lib/protocol.ts` + `backend/src/allhands/api/protocol.py` — `EmployeeCardProps` Pydantic + TypeScript twins for schema parity.
  - `backend/src/allhands/execution/tools/meta/employee_tools.py::execute_create_employee` — `create_employee` now returns the render envelope `{component: "EmployeeCard", props}` (previously a no-op stub); status-whitelist + system_prompt preview truncation + `model_ref` splitting baked in.
  - `backend/src/allhands/execution/tools/__init__.py` — `_META_TOOLS_WITH_EXECUTORS` tuple so other meta tools can graduate from the no-op stub without regressing registration.
  - `web/app/design-lab/page.tsx::EmployeeCardShowcase` — live samples (active · draft · paused · minimal props).
- regression tests:
  - `backend/tests/acceptance/test_w2_employee.py::test_render_card_for_employee_registered` — **xfail → hard assert**, checks component file + registry entry.
  - `backend/tests/acceptance/test_w2_employee.py::test_create_employee_returns_render_envelope` — new assert on the executor envelope shape.
  - `backend/tests/unit/test_employee_render_envelope.py` — 12 cases (shape · status whitelist · preview truncation · model_ref parsing · Pydantic parity · registry binding).
  - `web/tests/employee-card.test.tsx` — 6 cases (props · status variants · avatar derivation · minimal payload).
