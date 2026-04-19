"""Employee runtime **presets** — UI / contract-layer concept.

A preset is a recipe that expands into three existing ``Employee`` columns
(``tool_ids``, ``skill_ids``, ``max_iterations``). Presets are **never**
persisted; the red line in CLAUDE.md §3.2 forbids a ``mode``/``preset``/
``EmployeeKind`` column on the employee schema.

The three v0 presets come from ``docs/specs/agent-runtime-contract.md`` §4.1
and ``docs/specs/SIGNOFF-agent-runtime-contract.md`` Q6-Q10 (Q7 overrides
``plan_with_subagent`` default to 15).

Two adapter surfaces share the same §4.2 expansion algorithm:

- :func:`compose_preview` returns a :class:`PresetPreview` (used by the
  preview router + ``preview_employee_composition`` meta tool).
- :func:`expand_preset` returns a plain ``(tool_ids, skill_ids,
  max_iterations)`` tuple (used by ``employee_service.create`` and
  ``spawn_subagent._build_preset_child``).

Both funnel into :func:`compose_preview` so semantics can't drift.
"""

from __future__ import annotations

from types import ModuleType

from . import execute, plan, plan_with_subagent
from .execute import EXECUTE_PRESET
from .plan import PLAN_PRESET
from .plan_with_subagent import PLAN_WITH_SUBAGENT_PRESET
from .preview import Preset, PresetPreview, compose_preview

PRESETS: dict[str, Preset] = {
    EXECUTE_PRESET.id: EXECUTE_PRESET,
    PLAN_PRESET.id: PLAN_PRESET,
    PLAN_WITH_SUBAGENT_PRESET.id: PLAN_WITH_SUBAGENT_PRESET,
}

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
    """Tuple-form adapter over :func:`compose_preview` for service-layer callers.

    Returns ``(tool_ids, skill_ids, max_iterations)``.
    """
    if preset_id not in PRESETS:
        raise KeyError(f"Unknown preset {preset_id!r} · valid: {sorted(PRESETS)}")
    preview = compose_preview(
        PRESETS[preset_id],
        custom_tool_ids=custom_tool_ids,
        custom_skill_ids=custom_skill_ids,
        custom_max_iterations=custom_max_iterations,
    )
    return preview.tool_ids, preview.skill_ids, preview.max_iterations


__all__ = [
    "EXECUTE_PRESET",
    "MODES",
    "PLAN_PRESET",
    "PLAN_WITH_SUBAGENT_PRESET",
    "PRESETS",
    "Preset",
    "PresetPreview",
    "compose_preview",
    "expand_preset",
]
