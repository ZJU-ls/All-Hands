"""``plan_with_subagent`` preset — plan + dispatch subagents.

SIGNOFF Q7 lowered ``max_iterations`` from the contract's 20 to **15** (UX: 20 过高).
Ref: ref-src-claude/V10 §4.5 · teammate/subagent no grand-children in v0.
"""

from __future__ import annotations

from .preview import Preset

PLAN_WITH_SUBAGENT_PRESET = Preset(
    id="plan_with_subagent",
    friendly_name_zh="计划+派子代理",
    description="先出计划并派发子代理执行,最多 15 步。",
    tool_ids_base=[
        "allhands.builtin.render_plan",
        "allhands.meta.spawn_subagent",
        "allhands.meta.resolve_skill",
        "allhands.meta.read_skill_file",
    ],
    skill_ids_whitelist=["sk_planner", "sk_executor_spawn"],
    max_iterations=15,
)

ID = PLAN_WITH_SUBAGENT_PRESET.id
LABEL_ZH = PLAN_WITH_SUBAGENT_PRESET.friendly_name_zh
TOOL_IDS_BASE: tuple[str, ...] = tuple(PLAN_WITH_SUBAGENT_PRESET.tool_ids_base)
SKILL_IDS_WHITELIST: tuple[str, ...] = tuple(PLAN_WITH_SUBAGENT_PRESET.skill_ids_whitelist)
MAX_ITERATIONS = PLAN_WITH_SUBAGENT_PRESET.max_iterations
