"""``plan`` preset — "先出计划" recipe, 3-step cap (contract §4.1).

Outputs a structured plan via render_plan and stops.
Ref: ref-src-claude/V04 §2.5 · tool scope fail-closed.
"""

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

ID = PLAN_PRESET.id
LABEL_ZH = PLAN_PRESET.friendly_name_zh
TOOL_IDS_BASE: tuple[str, ...] = tuple(PLAN_PRESET.tool_ids_base)
SKILL_IDS_WHITELIST: tuple[str, ...] = tuple(PLAN_PRESET.skill_ids_whitelist)
MAX_ITERATIONS = PLAN_PRESET.max_iterations
