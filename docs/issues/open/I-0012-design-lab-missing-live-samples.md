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
