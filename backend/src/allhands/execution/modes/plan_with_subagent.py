"""`plan_with_subagent` preset — coordinator. Contract § 4.1.

Q7 signoff (2026-04-19): max_iterations 20 → 15 (UX: 20 过高).
Ref: ref-src-claude/V10 § 4.5 · teammate/subagent no grand-children in v0.
"""

from __future__ import annotations

ID = "plan_with_subagent"
LABEL_ZH = "协调员"
DESCRIPTION = (
    "Coordinator. Plans first, then dispatches subagents to execute. "
    "May still run some builtin tools directly."
)
TOOL_IDS_BASE: tuple[str, ...] = (
    "allhands.builtin.render_plan",
    "allhands.meta.spawn_subagent",
    "allhands.meta.resolve_skill",
)
SKILL_IDS_WHITELIST: tuple[str, ...] = ("sk_planner", "sk_executor_spawn")
MAX_ITERATIONS = 15
