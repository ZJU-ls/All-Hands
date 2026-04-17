"""SkillRegistry — maps skill IDs to Skill domain objects and expands them."""

from __future__ import annotations

from typing import TYPE_CHECKING

from allhands.core import Employee, Skill, Tool

if TYPE_CHECKING:
    from allhands.execution.registry import ToolRegistry


class SkillRegistry:
    def __init__(self) -> None:
        self._skills: dict[str, Skill] = {}

    def register(self, skill: Skill) -> None:
        self._skills[skill.id] = skill

    def get(self, skill_id: str) -> Skill | None:
        return self._skills.get(skill_id)

    def list_all(self) -> list[Skill]:
        return list(self._skills.values())


def seed_skills(registry: SkillRegistry) -> None:
    registry.register(
        Skill(
            id="sk_research",
            name="web_research",
            description="Research the web using fetch_url and summarize findings.",
            tool_ids=["allhands.builtin.fetch_url"],
            prompt_fragment=(
                "You are a thorough researcher. Search for information by fetching URLs, "
                "read and synthesize content carefully. Always cite the sources you used."
            ),
            version="0.1.0",
        )
    )
    registry.register(
        Skill(
            id="sk_write",
            name="file_writing",
            description="Write structured documents and save them to files.",
            tool_ids=["allhands.builtin.write_file"],
            prompt_fragment=(
                "You are a precise writer. When asked to produce a document, write it in "
                "clean markdown and save it using write_file with a descriptive filename."
            ),
            version="0.1.0",
        )
    )


def expand_skills_to_tools(
    employee: Employee,
    skill_registry: SkillRegistry,
    tool_registry: ToolRegistry,
) -> tuple[list[Tool], str]:
    """Return (tools, combined_prompt_fragment) for an employee.

    Merges employee.tool_ids and expanded employee.skill_ids, deduplicating.
    Returns prompt fragments concatenated in skill order.
    """
    seen: set[str] = set()
    tools: list[Tool] = []
    fragments: list[str] = []

    for tid in employee.tool_ids:
        if tid not in seen:
            try:
                tool, _ = tool_registry.get(tid)
                tools.append(tool)
                seen.add(tid)
            except KeyError:
                pass

    for sid in employee.skill_ids:
        skill = skill_registry.get(sid)
        if skill is None:
            continue
        if skill.prompt_fragment:
            fragments.append(skill.prompt_fragment)
        for tid in skill.tool_ids:
            if tid not in seen:
                try:
                    tool, _ = tool_registry.get(tid)
                    tools.append(tool)
                    seen.add(tid)
                except KeyError:
                    pass

    return tools, "\n\n".join(fragments)
