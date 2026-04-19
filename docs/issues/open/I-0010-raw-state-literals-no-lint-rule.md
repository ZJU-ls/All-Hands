---
id: I-0010
title: Raw "Loading…" / "Error" / "No data" literals across app · no ESLint rule enforces
severity: P1
status: open
discovered_at: 2026-04-19
discovered_by: track-2-qa audit
affects: web/** · visual-upgrade DoD
reproducible: true
blocker_for: visual-upgrade DoD ("裸 Loading/Error/No data grep = 0")
tags: [ui, visual, lint]
---

# I-0010 · Raw state literals + no ESLint rule to prevent regression

## Repro

1. `rg -n "Loading\\.\\.\\.|No data|No data\\." web/app web/components` — non-zero hits
2. `cat web/.eslintrc.json` — only extends `next/core-web-vitals` + `next/typescript`; no rule forbids the literals.

## Expected

Same spec as I-0007 but aimed at the enforcement mechanism rather than the missing components. The visual-upgrade DoD asks for a grep-zero assertion to prevent regressions after the initial sweep.

## Actual

Even after I-0007 is fixed (components built), nothing stops a new commit from re-introducing a raw `"Loading..."` literal.

## Suggested fix

1. Add an ESLint rule via `no-restricted-syntax` or a tiny custom rule that bans `JSXText | StringLiteral` matching `/^(Loading\.?\.?\.?|Error|No data)\.?$/` outside `components/state/**` and story/test files.
2. Or, keep it as a vitest static-contract test in `web/tests/error-patterns.test.ts` (cheaper, same effect).
3. Wire the failure message to point at `components/state/*` as the right solution.

## Acceptance criteria

- [ ] Rule implemented (ESLint OR vitest — pick one)
- [ ] CI fails on introducing a new raw literal
- [ ] Existing offenders are either migrated (preferred) or explicitly waived with a per-line comment

## Related

- tied to I-0007 (the state components must exist before enforcement is meaningful)
- spec: `docs/specs/agent-design/2026-04-18-visual-upgrade.md § DoD`
