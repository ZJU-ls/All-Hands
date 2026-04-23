---
name: allhands-dev
description: Project-specific development rules for allhands — 6 core principles (Tool First · Unified React Agent · Pure-Function Query Loop · Skill as Dynamic Capability Pack · Subagent as Composition Primitive · L4+Gate · Layer Isolation+Checkpointable State). See ADR 0011. Invoke before any code change in this repo.
---

# allhands Dev Rules (short form)

Full contract: `CLAUDE.md`. Full architecture: `product/04-architecture.md`. Principle refresh context: [ADR 0011](../../../product/adr/0011-principles-refresh.md).

## The 6 Laws (排序即优先级)

1. **Tool First** — every capability is a Tool (Backend / Render / Meta). New feature = register a new Tool + expose dual entry (REST + Meta Tool for agent-managed resources).
2. **Unified React Agent** — no `mode` field. Employees differ only by `tools[]`, `skill_ids[]`, `max_iterations`, `system_prompt`, `model_ref`.
3. **Pure-Function Query Loop** — `runner.stream(messages, thread_id)` is a pure fn of state. Runner rebuilds tools + prompt **every turn** from `SkillRuntime`. No mutable state in runner. LangGraph types never leak above `execution/`.
4. **Skill = Dynamic Capability Pack** — skill descriptors (≤50 chars) live in prompt always; tool_ids + fragments load lazily on `resolve_skill` activation. Activated state **persists across process restarts** (SkillRuntimeRepo).
5. **Subagent = Composition Primitive** — `dispatch_employee` / `spawn_subagent` reuse the same `AgentRunner`. Never a second agent code path. Budgets (`max_iterations` / `timeout_seconds`) are hard limits.
6. **L4 + Gate + Interrupt** — Tools declare `scope` (READ/WRITE/IRREVERSIBLE/BOOTSTRAP). WRITE+ goes through `ConfirmationGate` (LangGraph interrupt analog). BOOTSTRAP writes candidate version + explicit switch.

Plus the hard-rail companion:

7. **Layer Isolation + State Checkpointable** — `core/` imports only pydantic + stdlib. Any runtime state that affects future turns must live in a repo (no in-memory-only dicts). Enforced by `lint-imports` + `test_skill_runtime_persistence`.

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
