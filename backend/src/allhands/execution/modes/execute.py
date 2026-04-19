"""`execute` preset — standard doer. Contract § 4.1.

Ref: ref-src-claude/V05 · skills on demand, not pre-loaded.
"""

from __future__ import annotations

ID = "execute"
LABEL_ZH = "标准执行员"
DESCRIPTION = (
    "Standard doer. Fetches, writes, runs builtin tools. No planning, "
    "no subagents. Picks up skills on demand via resolve_skill."
)
TOOL_IDS_BASE: tuple[str, ...] = (
    "allhands.builtin.fetch_url",
    "allhands.builtin.write_file",
    "allhands.meta.resolve_skill",
)
SKILL_IDS_WHITELIST: tuple[str, ...] = ("sk_research", "sk_write")
MAX_ITERATIONS = 10
