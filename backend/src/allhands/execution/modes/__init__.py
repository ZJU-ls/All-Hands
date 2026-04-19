"""Preset definitions — UI/contract-level shapes, expanded into employee fields.

Spec: docs/specs/agent-runtime-contract.md § 4.
CLAUDE.md § 3.2 red line: `mode` / `preset` / `kind` fields never land in DB.
Preset is a form template — the service layer expands it into
`(tool_ids, skill_ids, max_iterations)` on create/edit.

Ref: ref-src-claude/V05 — "Skills declared but not pre-loaded." Preset is our
equivalent of that: a declaration the platform understands at UI time,
never a runtime branch.
"""

from __future__ import annotations

from types import ModuleType

from . import execute, plan, plan_with_subagent

MODES: dict[str, ModuleType] = {
    execute.ID: execute,
    plan.ID: plan,
    plan_with_subagent.ID: plan_with_subagent,
}


def expand_preset(
    preset_id: str,
    *,
    custom_tool_ids: list[str] | None = None,
    custom_skill_ids: list[str] | None = None,
    custom_max_iterations: int | None = None,
) -> tuple[list[str], list[str], int]:
    """Expand a preset + optional user overrides into concrete employee fields.

    Returns (tool_ids, skill_ids, max_iterations). tool_ids = dedupe(base + custom).
    Q6 signoff: skill_ids_whitelist is a UI seed only; when the caller sends
    custom_skill_ids, it is used as-is (user may add or remove freely).
    """
    if preset_id not in MODES:
        raise KeyError(f"Unknown preset {preset_id!r} · valid: {sorted(MODES)}")
    mod = MODES[preset_id]
    merged_tools: list[str] = []
    seen: set[str] = set()
    for tid in list(mod.TOOL_IDS_BASE) + list(custom_tool_ids or []):
        if tid not in seen:
            merged_tools.append(tid)
            seen.add(tid)
    if custom_skill_ids is not None:
        skills = list(custom_skill_ids)
    else:
        skills = list(mod.SKILL_IDS_WHITELIST)
    max_it = custom_max_iterations if custom_max_iterations is not None else int(mod.MAX_ITERATIONS)
    return merged_tools, skills, max_it
