---
id: I-0009
title: product/04-architecture.md never updated for triggers L5.9 + cockpit L7.1/L8.1
severity: P1
status: open
discovered_at: 2026-04-19
discovered_by: track-2-qa audit
affects: product/04-architecture.md
reproducible: true
blocker_for: L01 discoverability (new contributors can't find triggers/cockpit in the arch map)
tags: [docs, backend]
---

# I-0009 · Architecture doc drift (triggers + cockpit)

## Repro

1. `rg -n "L5\.9|list_triggers" product/04-architecture.md` → 0 hits
2. `rg -n "/api/triggers|/api/cockpit" product/04-architecture.md` → 0 hits
3. Open the spec:
   - `docs/specs/agent-design/2026-04-18-triggers.md` requires a new L5.9 "Triggers & Event Bus" section + 8 rows in the L5.7 Meta Tools table + 9 rows in the L7.1 API table
   - `docs/specs/agent-design/2026-04-18-cockpit.md` requires 4 new endpoints in L7.1 + new entries in L8.1 SSE event types

## Expected

Architecture doc updates are part of both specs' DoD. They're how new contributors discover the moving parts without reading source.

## Actual

Code landed, tests green, doc untouched. The arch map is stale.

## Evidence

- Grep results above
- `backend/src/allhands/api/routers/{triggers.py,cockpit.py}` are present and wired
- `backend/src/allhands/execution/tools/meta/trigger_tools.py` exists with 8 tools

## Suggested fix

1. Add `§ L5.9 Triggers & Event Bus` subsection summarizing `execution/triggers/**` + event bus contract.
2. Extend L5.7 Meta Tools table with 8 trigger tools + 2 cockpit tools.
3. Extend L7.1 API table with `/api/triggers/*` (9 routes) + `/api/cockpit/*` (4 routes).
4. Extend L8.1 SSE event types with cockpit snapshot/delta frame types.

## Acceptance criteria

- [ ] Arch doc grep shows `L5.9`, `list_triggers`, `/api/triggers`, `/api/cockpit/stream` all present
- [ ] PR updates link both specs' DoD checkboxes

## Related

- spec: `docs/specs/agent-design/2026-04-18-triggers.md § DoD`
- spec: `docs/specs/agent-design/2026-04-18-cockpit.md § DoD`
