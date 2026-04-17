"""Tests for SkillRegistry and seed skills."""

from __future__ import annotations

from datetime import UTC, datetime

from allhands.core import Employee, Skill
from allhands.execution.registry import ToolRegistry
from allhands.execution.skills import SkillRegistry, expand_skills_to_tools, seed_skills
from allhands.execution.tools import discover_builtin_tools


def test_skill_registry_register_and_get() -> None:
    reg = SkillRegistry()
    skill = Skill(
        id="sk_test",
        name="test",
        description="test skill",
        tool_ids=["allhands.builtin.fetch_url"],
        version="0.1.0",
    )
    reg.register(skill)
    assert reg.get("sk_test") == skill


def test_skill_registry_get_missing_returns_none() -> None:
    reg = SkillRegistry()
    assert reg.get("nonexistent") is None


def test_seed_skills_creates_web_research_and_write() -> None:
    reg = SkillRegistry()
    seed_skills(reg)
    skills = reg.list_all()
    ids = {s.id for s in skills}
    assert "sk_research" in ids
    assert "sk_write" in ids


def test_expand_skills_to_tools() -> None:
    tool_reg = ToolRegistry()
    discover_builtin_tools(tool_reg)

    skill_reg = SkillRegistry()
    seed_skills(skill_reg)

    now = datetime.now(UTC)
    emp = Employee(
        id="e1",
        name="Researcher",
        description="",
        system_prompt="base prompt",
        model_ref="openai/gpt-4o-mini",
        skill_ids=["sk_research"],
        created_by="user",
        created_at=now,
    )
    tools, prompt_addition = expand_skills_to_tools(emp, skill_reg, tool_reg)
    tool_ids = {t.id for t in tools}
    assert "allhands.builtin.fetch_url" in tool_ids
    assert prompt_addition != ""
