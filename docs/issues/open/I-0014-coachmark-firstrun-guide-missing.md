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
