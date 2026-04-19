"""``plan_with_subagent`` preset — plan + dispatch subagents.

SIGNOFF Q7 lowered ``max_iterations`` from the contract's 20 to **15**.
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
    ],
    skill_ids_whitelist=["sk_planner", "sk_executor_spawn"],
    max_iterations=15,
)
