"""Employee runtime **presets** — UI / contract-layer concept.

A preset is a recipe that expands into three existing ``Employee`` columns
(``tool_ids``, ``skill_ids``, ``max_iterations``). Presets are **never**
persisted; the red line in CLAUDE.md §3.2 forbids a ``mode``/``preset``/
``EmployeeKind`` column on the employee schema.

The three v0 presets come straight from
``docs/specs/agent-runtime-contract.md`` §4.1 and
``docs/specs/SIGNOFF-agent-runtime-contract.md`` Q6-Q10 (Q7 overrides the
``plan_with_subagent`` default to 15).

Each preset is a plain dataclass-shaped constant — **not** a class hierarchy
(I-0022 acceptance: ≤ 30 lines each, data over inheritance).
"""

from __future__ import annotations

from .execute import EXECUTE_PRESET
from .plan import PLAN_PRESET
from .plan_with_subagent import PLAN_WITH_SUBAGENT_PRESET
from .preview import Preset, PresetPreview, compose_preview

PRESETS: dict[str, Preset] = {
    EXECUTE_PRESET.id: EXECUTE_PRESET,
    PLAN_PRESET.id: PLAN_PRESET,
    PLAN_WITH_SUBAGENT_PRESET.id: PLAN_WITH_SUBAGENT_PRESET,
}

__all__ = [
    "EXECUTE_PRESET",
    "PLAN_PRESET",
    "PLAN_WITH_SUBAGENT_PRESET",
    "PRESETS",
    "Preset",
    "PresetPreview",
    "compose_preview",
]
