---
id: I-0008
title: EmployeeCard render component not registered — create_employee result cannot render in chat
severity: P1
status: open
discovered_at: 2026-04-19
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

- [ ] Component exists + registered
- [ ] Design-lab shows a live sample
- [ ] test_w2_employee no longer xfails
- [ ] Walkthrough-acceptance W2 scores N1=green with evidence

## Related

- spec: `docs/specs/agent-design/2026-04-18-employee-chat.md`
- spec: `docs/specs/agent-design/2026-04-18-walkthrough-acceptance.md W2`
- meta-tool: `backend/src/allhands/execution/tools/meta/employee_tools.py::CREATE_EMPLOYEE_TOOL`
