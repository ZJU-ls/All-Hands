---
name: allhands-dev
description: Project-specific development rules for allhands — Tool First architecture, unified React Agent (no mode field), L4 Lead Agent scope with confirmation gates, strict layering. Invoke before any code change in this repo.
---

# allhands Dev Rules (short form)

Full contract: `CLAUDE.md`. Full architecture: `product/04-architecture.md`.

## The 4 Laws

1. **Tool First** — every capability is a Tool (Backend / Render / Meta). New feature = register a new Tool, not a new endpoint / page.
2. **Unified React Agent** — no `mode` field. Employees differ only by `tools[]`, `skill_ids[]`, `max_iterations`, `system_prompt`, `model_ref`.
3. **L4 with gates** — Tools declare `scope` (READ/WRITE/IRREVERSIBLE/BOOTSTRAP). WRITE+ goes through `ConfirmationGate`. BOOTSTRAP writes candidate version + explicit switch.
4. **Layer isolation** — `core/` imports only pydantic + stdlib. Enforced by `lint-imports`.

## Hard "no"s

- No `mode` field in schemas
- No REST CRUD endpoints for Employee/Skill/MCP (use Meta Tools)
- No standalone config pages (use Lead Agent + render tools)
- No framework imports in `core/`
- No untested implementation

## Before changing code

1. Check `plans/` for current task
2. Read `CLAUDE.md §6` (discipline)
3. If architecturally novel → propose an ADR, don't freelance

## Before claiming done

Run `./scripts/check.sh`. Green = proceed. Red = fix, don't skip.
