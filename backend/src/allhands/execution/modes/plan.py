"""``plan`` preset — agent 自己做计划 · 自己执行(无子代理 · 15 步)。
ADR 0019 C1:plan_create 家族替换老 render_plan · 用户 2026-04-25 反馈。
"""

from __future__ import annotations

from .preview import Preset

PLAN_PRESET = Preset(
    id="plan",
    friendly_name_zh="先出计划",
    description="先做计划再自己执行,15 步上限,不调用子代理。",
    tool_ids_base=[
        "allhands.builtin.fetch_url",
        "allhands.meta.plan_create",
        "allhands.meta.plan_update_step",
        "allhands.meta.plan_complete_step",
        "allhands.meta.plan_view",
        "allhands.meta.resolve_skill",
        "allhands.meta.read_skill_file",
    ],
    skill_ids_whitelist=["sk_planner", "sk_research", "sk_write"],
    max_iterations=15,
)
ID = PLAN_PRESET.id
LABEL_ZH = PLAN_PRESET.friendly_name_zh
TOOL_IDS_BASE: tuple[str, ...] = tuple(PLAN_PRESET.tool_ids_base)
SKILL_IDS_WHITELIST: tuple[str, ...] = tuple(PLAN_PRESET.skill_ids_whitelist)
MAX_ITERATIONS = PLAN_PRESET.max_iterations
