---
id: I-0007
title: Shared state components (EmptyState / ErrorState / LoadingState / FirstRun) never built
severity: P0
status: closed
discovered_at: 2026-04-19
closed_at: 2026-04-19
discovered_by: track-2-qa audit
affects: web/components/** (≥17 pages) · visual-upgrade spec
reproducible: true
blocker_for: visual-upgrade DoD, self-review Round 3 (爱不释手 · 空/错/加载态), walkthrough N6
tags: [ui, visual]
---

# I-0007 · Shared state components missing

## Repro

1. `rg -l EmptyState web/components/` → 0
2. `rg -l ErrorState web/components/` → 0
3. `rg -l LoadingState web/components/` → 0
4. `rg -l FirstRun web/components/` → 0
5. Open any page under `web/app/**/page.tsx` — see bare `"Loading..."` / `"Error"` / `"No data"` string literals.

## Expected

`docs/specs/agent-design/2026-04-18-visual-upgrade.md §5.x` mandates shared state components:
- `<EmptyState illustration name={...} cta={...} />`
- `<ErrorState ref={...} action={retry} />`
- `<LoadingState skeleton />`
- `<FirstRun />` (cockpit-specific first-run guide)

DoD explicitly asserts "所有现有页面没有裸 Loading/Error/No data(grep 0)".

## Actual

None of the components exist. Raw strings proliferate across the frontend. Every empty/error/loading state looks like a debug message rather than a designed surface. Self-review Round 3 will fail this en masse. Walkthrough N6 (failure-recoverable) cannot be green until users have a next-step cue on failure.

## Evidence

- Glob `web/components/**/{Empty,Error,Loading,FirstRun}*.tsx` → no matches
- `rg -n "Loading\.\.\." web/app/ | wc -l` (spot check) — many hits (exact count to be filled when someone commits to the fix)

## Suggested fix

1. Create `web/components/state/{EmptyState,ErrorState,LoadingState}.tsx` with Linear Precise styling (border tokens · mono char · no icons).
2. Create `web/components/state/FirstRun.tsx` for workspace zero-state (cockpit empty case).
3. Sweep the app: replace raw strings (this is where the work is).
4. Add an ESLint rule (or grep regression test) that fails the build if bare strings like `"Loading..."` / `"No data"` / `"Error:"` appear in page/component files outside `components/state/`.

## Acceptance criteria

- [ ] Four components exist with typed props + stories in design-lab
- [ ] All usage sites migrated
- [ ] `rg -n "\"Loading\\.\\.\\.\"|\"No data\"|\"Error: \"" web/app web/components` returns 0 (excluding state/ folder)
- [ ] ESLint or test regression prevents regression

## Related

- spec: `docs/specs/agent-design/2026-04-18-visual-upgrade.md § 5 · DoD`
- CLAUDE.md §3.5 视觉纪律(空态必须是设计 · 不能是纯文本)

## 关闭记录

- status: closed
- closed_at: 2026-04-19
- fix: shipped `web/components/state/{EmptyState,ErrorState,LoadingState,FirstRun}.tsx` with shared `StateAction` / `FirstRunStep` types. All use design tokens only (no icon libs, no raw Tailwind colors, no `dark:` parallel classes). Live samples added to `web/app/design-lab/page.tsx` (`StateShowcase` section).
- regression tests: `backend/tests/acceptance/test_audit_regressions.py::test_i0007_state_component_exists[EmptyState|ErrorState|LoadingState|FirstRun]` (4 xfails → pass) + `web/components/state/__tests__/state.test.tsx` (6 cases across props / roles / action wiring).
- consumer: `web/components/cockpit/Cockpit.tsx` is the first production site to use them (loading / empty / error branches). Full sweep of raw `"Loading…"` / `"No data"` / `"Error:"` literals is tracked separately under I-0010 (P1).
