"""``plan_with_subagent`` preset — 计划 + 派子代理并行执行(20 步)。
ADR 0019 C1:plan_create 家族替换老 render_plan · 用户 2026-04-25 反馈。
"""

from __future__ import annotations

from .preview import Preset

PLAN_WITH_SUBAGENT_PRESET = Preset(
    id="plan_with_subagent",
    friendly_name_zh="计划+派子代理",
    tool_ids_base=[
        "allhands.meta.plan_create",
        "allhands.meta.plan_update_step",
        "allhands.meta.plan_complete_step",
        "allhands.meta.plan_view",
        "allhands.meta.spawn_subagent",
        "allhands.meta.resolve_skill",
        "allhands.meta.read_skill_file",
    ],
    skill_ids_whitelist=["sk_planner", "sk_executor_spawn"],
    max_iterations=20,
)
ID = PLAN_WITH_SUBAGENT_PRESET.id
LABEL_ZH = PLAN_WITH_SUBAGENT_PRESET.friendly_name_zh
TOOL_IDS_BASE: tuple[str, ...] = tuple(PLAN_WITH_SUBAGENT_PRESET.tool_ids_base)
SKILL_IDS_WHITELIST: tuple[str, ...] = tuple(PLAN_WITH_SUBAGENT_PRESET.skill_ids_whitelist)
MAX_ITERATIONS = PLAN_WITH_SUBAGENT_PRESET.max_iterations
