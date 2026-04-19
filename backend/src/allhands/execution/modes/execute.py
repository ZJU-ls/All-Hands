"""``execute`` preset — the default "do it" worker recipe.

Contract §4.1 + SIGNOFF Q6. Friendly name 标准执行.
Ref: ref-src-claude/V05 · skills declared but not pre-loaded.
"""

from __future__ import annotations

from .preview import Preset

EXECUTE_PRESET = Preset(
    id="execute",
    friendly_name_zh="标准执行",
    description="直接执行任务:取/写文件,走技能白名单,10 步上限。",
    tool_ids_base=[
        "allhands.builtin.fetch_url",
        "allhands.builtin.write_file",
        "allhands.meta.resolve_skill",
    ],
    skill_ids_whitelist=["sk_research", "sk_write"],
    max_iterations=10,
)

ID = EXECUTE_PRESET.id
LABEL_ZH = EXECUTE_PRESET.friendly_name_zh
TOOL_IDS_BASE: tuple[str, ...] = tuple(EXECUTE_PRESET.tool_ids_base)
SKILL_IDS_WHITELIST: tuple[str, ...] = tuple(EXECUTE_PRESET.skill_ids_whitelist)
MAX_ITERATIONS = EXECUTE_PRESET.max_iterations
