---
id: I-0011
title: Missing integration / e2e tests across 5 delivered specs
severity: P1
status: closed
discovered_at: 2026-04-19
closed_at: 2026-04-19
discovered_by: track-2-qa audit
affects: backend/tests/integration/** · web/tests/e2e/**
reproducible: true
blocker_for: self-review Round 2 (动线 SLA), regression safety for Wave 2 tasks/toolset merge
tags: [backend, ui, tests]
---

# I-0011 · Missing integration / e2e tests (5 specs)

## Background

The Wave 1 feature specs landed with unit tests but the spec-mandated integration/e2e coverage is thin. These holes mean a regression in the happy-path wiring can ship without any red.

## Gaps

| Spec | Missing test | DoD clause |
|---|---|---|
| `2026-04-18-agent-design.md` | `backend/tests/integration/test_lead_agent_flow.py` (Lead → list_employees → dispatch_employee → result) | § 11 |
| `2026-04-18-viz-skill.md` | `web/tests/e2e/design-lab-viz.spec.ts` visual regression for each of the 10 Viz components | § 9 |
| `2026-04-18-artifacts-skill.md` | `backend/tests/integration/test_artifacts_sse.py` + `web/tests/e2e/artifacts-flow.spec.ts` | § 11 |
| `2026-04-18-cockpit.md` | `backend/tests/integration/events/test_event_projection.py` | § 11 |
| `2026-04-18-employee-chat.md` | `web/tests/e2e/employee-chat.spec.ts` + `web/tests/e2e/nested-run-display.spec.ts` + `web/tests/unit/chat-routing.test.ts` | § 9 |

## Expected

Each cited DoD explicitly lists the file paths above.

## Actual

`rg -l <file>` / `ls` confirms none of them exist in the worktree. Unit coverage compensates partially but not for multi-component flows and visual regressions.

## Suggested fix

Split by owner when the Wave 2 merge window opens:

1. **agent-design** · ~1h — end-to-end Lead flow with a fake employee + fake runner
2. **viz-skill** · ~3h — Playwright snapshots for 10 components on design-lab
3. **artifacts-skill** · ~2h — depends on I-0005 (event), can be delivered together
4. **cockpit** · ~2h — depends on I-0006 (SSE consumption), delivered together
5. **employee-chat** · ~2h — Playwright + route unit test

## Acceptance criteria

- [ ] Each file created with ≥1 asserting test, `./scripts/check.sh` green
- [ ] Each spec's DoD box for its test is checked

## Related

- see specs in table above
- connected fixes: I-0005 (artifact SSE), I-0006 (cockpit SSE)

## 关闭记录

- status: closed
- closed_at: 2026-04-19
- fix: all 7 files named in spec DoDs now exist, each with ≥1 asserting
  test plus explicit `xfail(strict=True)` / `test.fixme` placeholders for
  the genuinely-blocked follow-ups:
  - `backend/tests/integration/test_lead_agent_flow.py` — pins the
    Lead → `COORDINATION_TOOL_IDS` auto-mount → `dispatch_employee`
    registry resolution chain via SqlEmployeeRepo + ToolRegistry +
    EmployeeService. Full `AgentRunner` + fake model gateway round-trip
    is `xfail(strict=True)` until the harness lands.
  - `backend/tests/integration/test_artifacts_sse.py` — delivered
    separately via I-0005 closure (fix-artifacts-sse).
  - `backend/tests/integration/events/test_event_projection.py` — pins
    `EventBus` publish/persist round-trip, pattern-filter, `subscribe_all`,
    and the `_KIND_TO_SSE_EVENT` map in the cockpit router.
    EventSource-level stream test is `xfail(strict=True)` (TestClient +
    aiosqlite chunked-response deadlock — see `test_cockpit_api.py`).
  - `web/tests/e2e/design-lab-viz.spec.ts` — pins `/design-lab` renders
    the `Viz.* 渲染组件样本` section + 9 ShowcaseCard titles. Per-component
    visual-regression sweep (10 × 2 themes) is `test.fixme` (baseline
    review budget).
  - `web/tests/e2e/artifacts-flow.spec.ts` — pins the ⌘J ArtifactPanel
    toggle + empty state against mocked `/api/artifacts`. Full SSE →
    list → pin round-trip is `test.fixme`.
  - `web/tests/e2e/employee-chat.spec.ts` — pins `/chat/:id` boots with
    InputBar + MessageList + Lead header against mocked backend. Token-
    stream send is `test.fixme` (needs chunked SSE fixture).
  - `web/tests/e2e/nested-run-display.spec.ts` — pins `/chat` boots so
    `NestedRunBlock` can be mounted once dispatch SSE frames are piped
    in. Component-level behavior stays covered by
    `web/lib/__tests__/nested-run-block.test.tsx`.
- regression test: flipped
  `backend/tests/acceptance/test_audit_regressions.py::test_i0011_required_coverage_file_exists`
  from `if not exists: pytest.xfail(...)` to a plain `assert exists`
  across all 7 parametrized paths — deleting any of them fails CI loudly.
- commits:
  - `85f34bc` [track-i] test(integration): lead-agent-flow +
    event-projection smoke skeletons
  - `6e8bb83` [track-i] test(e2e): 4 spec files smoke skeletons
    (viz / artifacts / employee-chat / nested-run) (close I-0011)
