"""`plan` preset — planner only. Contract § 4.1.

Outputs a structured plan via render_plan and stops.
Ref: ref-src-claude/V04 § 2.5 · tool scope fail-closed.
"""

from __future__ import annotations

ID = "plan"
LABEL_ZH = "纯规划员"
DESCRIPTION = (
    "Planner only. Emits a full plan via render_plan and waits for "
    "human approval before any doer runs."
)
TOOL_IDS_BASE: tuple[str, ...] = (
    "allhands.builtin.render_plan",
    "allhands.meta.resolve_skill",
)
SKILL_IDS_WHITELIST: tuple[str, ...] = ("sk_planner",)
MAX_ITERATIONS = 3
