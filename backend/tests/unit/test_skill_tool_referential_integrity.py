"""Static guard · every tool_id referenced by a builtin skill must exist
in the default ToolRegistry.

Why this exists
---------------

We had a regression where ``sk_planner`` referenced ``allhands.builtin.render_plan``
after that tool was de-registered (ADR 0019). The skill descriptor still
told the agent "call render_plan" via the prompt body, but the executor
was missing — so the model emitted phantom tool_calls that got dropped,
leaving the turn with no text and no tool_uses. The loop exited silently.

This test catches that class of bug at *load time* rather than waiting
for a user to hit it in chat. If you de-register a tool, this test
forces you to update every skill that referenced it (or re-register
under an alias).

It also covers ``seed_skills`` — the legacy hand-coded skills inside
``execution/skills.py`` that aren't on disk.
"""

from __future__ import annotations

from allhands.execution.registry import ToolRegistry
from allhands.execution.skills import SkillRegistry, seed_skills
from allhands.execution.tools import discover_builtin_tools


def test_every_builtin_skill_tool_id_is_registered() -> None:
    tool_registry = ToolRegistry()
    discover_builtin_tools(tool_registry)
    registered_ids = {tool.id for tool in tool_registry.list_all()}

    skill_registry = SkillRegistry()
    seed_skills(skill_registry)

    offences: list[tuple[str, str]] = []
    for skill in skill_registry.list_all():
        for tool_id in skill.tool_ids:
            if tool_id not in registered_ids:
                offences.append((skill.id, tool_id))

    assert not offences, (
        "skill(s) reference tool_ids that are not in the default ToolRegistry — "
        "either re-register the tool or update the skill manifest:\n"
        + "\n".join(f"  - {sid} → {tid}" for sid, tid in offences)
    )
