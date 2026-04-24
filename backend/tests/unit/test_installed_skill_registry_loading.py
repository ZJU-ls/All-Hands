"""Installed skills must land in SkillRegistry so employees that mount them
can actually discover them at runtime. Without this, `list_all()` in the
DB returns the skill but `SkillRegistry.get_full(id)` returns None, so the
agent sees an ID in `employee.skill_ids` that doesn't resolve — it ends up
listing only built-in skills in the system prompt and tool calls fail.

Regression: surfaced during ADR 0015 smoke when an employee mounted an
installed `algorithmic-art` skill and the Lead's agent couldn't see it.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from allhands.core import Skill, SkillSource
from allhands.execution.skills import (
    SkillRegistry,
    load_installed_skills,
    seed_skills,
)


class _FakeSkillRepo:
    def __init__(self, skills: list[Skill]) -> None:
        self._skills = skills

    async def list_all(self) -> list[Skill]:
        return list(self._skills)


@pytest.mark.asyncio
async def test_load_installed_skills_registers_market_and_github_sources() -> None:
    installed_a = Skill(
        id="aee5adab-b3ad-45a2-b7bb-85c1c673fdb6",
        name="algorithmic-art",
        description="Generative art toolkit",
        tool_ids=[],
        prompt_fragment="Use random seeds responsibly.",
        version="0.1.0",
        source=SkillSource.MARKET,
        source_url="github:anthropics/skills/algorithmic-art",
        path="data/skills/algorithmic-art",
        installed_at=datetime.now(UTC),
    )
    installed_b = Skill(
        id="f00d-beef",
        name="my-custom-skill",
        description="Custom github install",
        tool_ids=["allhands.builtin.fetch_url"],
        prompt_fragment=None,
        version="0.2.0",
        source=SkillSource.GITHUB,
        source_url="https://github.com/example/skill",
        path="data/skills/my-custom-skill",
        installed_at=datetime.now(UTC),
    )
    repo = _FakeSkillRepo([installed_a, installed_b])
    registry = SkillRegistry()

    count = await load_installed_skills(registry, repo)

    assert count == 2
    resolved_a = registry.get_full(installed_a.id)
    assert resolved_a is not None
    assert resolved_a.name == "algorithmic-art"
    assert resolved_a.path == "data/skills/algorithmic-art"

    resolved_b = registry.get_full(installed_b.id)
    assert resolved_b is not None
    assert resolved_b.tool_ids == ["allhands.builtin.fetch_url"]


@pytest.mark.asyncio
async def test_load_installed_skills_skips_builtin_rows() -> None:
    """Legacy: some test fixtures insert BUILTIN rows into the skills table.
    Built-in loading is seed_skills' job (reads from skills/builtin/*); we
    must not double-register and clobber the lazy loader.
    """
    builtin_row = Skill(
        id="allhands.render",
        name="render",
        description="Built-in via seed_skills",
        tool_ids=[],
        prompt_fragment=None,
        version="1.0.0",
        source=SkillSource.BUILTIN,
        source_url=None,
        path=None,
        installed_at=None,
    )
    repo = _FakeSkillRepo([builtin_row])
    registry = SkillRegistry()
    seed_skills(registry)  # registers the real allhands.render lazily

    # Snapshot the real loader's output so we can prove it was NOT replaced.
    pre = registry.get_full("allhands.render")

    count = await load_installed_skills(registry, repo)

    assert count == 0
    post = registry.get_full("allhands.render")
    assert post is not None
    # Description comes from the real SKILL.yaml, not the "Built-in via seed_skills" stub.
    assert post.description != "Built-in via seed_skills"
    assert pre is post or pre.description == post.description


@pytest.mark.asyncio
async def test_load_installed_skills_is_idempotent() -> None:
    skill = Skill(
        id="sk-idem",
        name="idem",
        description="d",
        tool_ids=[],
        prompt_fragment=None,
        version="0.1.0",
        source=SkillSource.MARKET,
        source_url=None,
        path="data/skills/idem",
        installed_at=datetime.now(UTC),
    )
    repo = _FakeSkillRepo([skill])
    registry = SkillRegistry()

    first = await load_installed_skills(registry, repo)
    second = await load_installed_skills(registry, repo)

    assert first == 1
    assert second == 1  # still reports 1 registered, not duplicated
    assert len(registry.list_descriptors()) == 1
