"""ADR 0015 Phase 2 · resolve_skill injects SKILL.md body on activation."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from allhands.core import Employee, Skill, SkillRuntime
from allhands.execution.skills import SkillRegistry
from allhands.execution.tools.meta.resolve_skill import make_resolve_skill_executor


def _make_employee(skill_ids: list[str]) -> Employee:
    return Employee(
        id="e1",
        name="t",
        description="d",
        system_prompt="sp",
        model_ref="p/m",
        skill_ids=skill_ids,
        tool_ids=[],
        created_by="u1",
        created_at=datetime.now(UTC),
    )


@pytest.mark.asyncio
async def test_activate_injects_skill_md_body(tmp_path: Path) -> None:
    skill_dir = tmp_path / "test-skill"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text(
        "---\nname: test-skill\ndescription: d\n---\n\n"
        "# Usage\n\nSee references/notes.md for deeper guidance.\n",
        encoding="utf-8",
    )

    registry = SkillRegistry()
    skill = Skill(
        id="skill-1",
        name="test-skill",
        description="d",
        tool_ids=[],
        prompt_fragment="fragment text",
        version="0.1.0",
        path=str(skill_dir),
    )
    registry.register(skill)

    runtime = SkillRuntime()
    employee = _make_employee(["skill-1"])
    executor = make_resolve_skill_executor(
        employee=employee,
        runtime=runtime,
        skill_registry=registry,
    )

    result = await executor(skill_id="skill-1")
    assert result["already_loaded"] is False

    joined = "\n".join(runtime.resolved_fragments)
    assert "fragment text" in joined, "prompt_fragment must still be injected"
    assert "See references/notes.md" in joined, "SKILL.md body must be injected"


@pytest.mark.asyncio
async def test_activate_without_skill_md_still_works(tmp_path: Path) -> None:
    """Built-in-style skill (SKILL.yaml, no SKILL.md) must not crash."""
    skill_dir = tmp_path / "builtin-like"
    skill_dir.mkdir()
    (skill_dir / "SKILL.yaml").write_text("name: b\n", encoding="utf-8")

    registry = SkillRegistry()
    skill = Skill(
        id="sk2",
        name="b",
        description="d",
        tool_ids=[],
        prompt_fragment="p",
        version="0.1.0",
        path=str(skill_dir),
    )
    registry.register(skill)

    runtime = SkillRuntime()
    employee = _make_employee(["sk2"])
    executor = make_resolve_skill_executor(
        employee=employee,
        runtime=runtime,
        skill_registry=registry,
    )

    result = await executor(skill_id="sk2")
    assert "error" not in result
    assert "p" in "\n".join(runtime.resolved_fragments)


@pytest.mark.asyncio
async def test_activate_without_path_does_not_crash(tmp_path: Path) -> None:
    """Legacy / eager skills may have no path; injection must be a no-op."""
    registry = SkillRegistry()
    skill = Skill(
        id="sk3",
        name="legacy",
        description="d",
        tool_ids=[],
        prompt_fragment="legacy fragment",
        version="0.1.0",
        path=None,
    )
    registry.register(skill)

    runtime = SkillRuntime()
    employee = _make_employee(["sk3"])
    executor = make_resolve_skill_executor(
        employee=employee,
        runtime=runtime,
        skill_registry=registry,
    )

    result = await executor(skill_id="sk3")
    assert "error" not in result
    assert "legacy fragment" in "\n".join(runtime.resolved_fragments)
