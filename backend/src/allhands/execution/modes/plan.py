"""``plan`` preset — "先出计划" recipe, 3-step cap (contract §4.1)."""

from __future__ import annotations

from .preview import Preset

PLAN_PRESET = Preset(
    id="plan",
    friendly_name_zh="先出计划",
    description="只出结构化计划(render_plan),不直接执行。",
    tool_ids_base=[
        "allhands.builtin.render_plan",
        "allhands.meta.resolve_skill",
    ],
    skill_ids_whitelist=["sk_planner"],
    max_iterations=3,
)
