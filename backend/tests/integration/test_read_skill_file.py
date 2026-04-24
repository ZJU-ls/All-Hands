"""ADR 0015 Phase 3 · read_skill_file integration with resolve_skill."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from allhands.core import Employee, Skill, SkillRuntime
from allhands.execution.skills import SkillRegistry
from allhands.execution.tools.meta.resolve_skill import make_resolve_skill_executor
from allhands.execution.tools.meta.skill_files import (
    MAX_READ_BYTES,
    make_read_skill_file_executor,
)


@pytest.fixture
def activated_runtime(tmp_path: Path) -> dict[str, object]:
    skill_dir = tmp_path / "demo"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text(
        "---\nname: demo\ndescription: d\n---\n\nuse references/notes.md\n",
        encoding="utf-8",
    )
    (skill_dir / "references").mkdir()
    (skill_dir / "references" / "notes.md").write_text("Detailed guidance.")

    registry = SkillRegistry()
    skill = Skill(
        id="demo",
        name="demo",
        description="d",
        tool_ids=[],
        prompt_fragment=None,
        version="0.1.0",
        path=str(skill_dir),
    )
    registry.register(skill)

    runtime = SkillRuntime()
    employee = Employee(
        id="e1",
        name="t",
        description="d",
        system_prompt="sp",
        model_ref="p/m",
        skill_ids=["demo"],
        tool_ids=[],
        created_by="u1",
        created_at=datetime.now(UTC),
    )
    return {
        "registry": registry,
        "runtime": runtime,
        "employee": employee,
        "skill_dir": skill_dir,
    }


@pytest.mark.asyncio
async def test_rejects_unactivated_skill(activated_runtime: dict[str, object]) -> None:
    reader = make_read_skill_file_executor(
        runtime=activated_runtime["runtime"],  # type: ignore[arg-type]
        skill_registry=activated_runtime["registry"],  # type: ignore[arg-type]
    )
    result = await reader(skill_id="demo", relative_path="references/notes.md")
    assert "not activated" in result.get("error", "")


async def _activate(ar: dict[str, object]) -> None:
    resolver = make_resolve_skill_executor(
        employee=ar["employee"],  # type: ignore[arg-type]
        runtime=ar["runtime"],  # type: ignore[arg-type]
        skill_registry=ar["registry"],  # type: ignore[arg-type]
    )
    await resolver(skill_id="demo")


@pytest.mark.asyncio
async def test_reads_reference_after_activation(
    activated_runtime: dict[str, object],
) -> None:
    await _activate(activated_runtime)
    reader = make_read_skill_file_executor(
        runtime=activated_runtime["runtime"],  # type: ignore[arg-type]
        skill_registry=activated_runtime["registry"],  # type: ignore[arg-type]
    )
    result = await reader(skill_id="demo", relative_path="references/notes.md")

    assert "error" not in result
    assert "Detailed guidance." in result["content"]
    assert result["bytes"] > 0
    assert result["path"] == "references/notes.md"


@pytest.mark.asyncio
async def test_rejects_traversal(activated_runtime: dict[str, object]) -> None:
    await _activate(activated_runtime)
    reader = make_read_skill_file_executor(
        runtime=activated_runtime["runtime"],  # type: ignore[arg-type]
        skill_registry=activated_runtime["registry"],  # type: ignore[arg-type]
    )
    result = await reader(skill_id="demo", relative_path="../../etc/hosts")
    assert "escapes" in result.get("error", "").lower()


@pytest.mark.asyncio
async def test_missing_file_returns_clean_error(
    activated_runtime: dict[str, object],
) -> None:
    await _activate(activated_runtime)
    reader = make_read_skill_file_executor(
        runtime=activated_runtime["runtime"],  # type: ignore[arg-type]
        skill_registry=activated_runtime["registry"],  # type: ignore[arg-type]
    )
    result = await reader(skill_id="demo", relative_path="nope.md")
    assert "not found" in result.get("error", "").lower()


@pytest.mark.asyncio
async def test_rejects_non_utf8(activated_runtime: dict[str, object], tmp_path: Path) -> None:
    await _activate(activated_runtime)
    skill_dir = activated_runtime["skill_dir"]
    assert isinstance(skill_dir, Path)
    binfile = skill_dir / "bin.dat"
    binfile.write_bytes(b"\xff\xfe\x00\x00not-utf8\xfe")
    reader = make_read_skill_file_executor(
        runtime=activated_runtime["runtime"],  # type: ignore[arg-type]
        skill_registry=activated_runtime["registry"],  # type: ignore[arg-type]
    )
    result = await reader(skill_id="demo", relative_path="bin.dat")
    assert "utf-8" in result.get("error", "").lower()


@pytest.mark.asyncio
async def test_rejects_oversized_file(
    activated_runtime: dict[str, object],
) -> None:
    await _activate(activated_runtime)
    skill_dir = activated_runtime["skill_dir"]
    assert isinstance(skill_dir, Path)
    big = skill_dir / "big.md"
    big.write_text("a" * (MAX_READ_BYTES + 10), encoding="utf-8")
    reader = make_read_skill_file_executor(
        runtime=activated_runtime["runtime"],  # type: ignore[arg-type]
        skill_registry=activated_runtime["registry"],  # type: ignore[arg-type]
    )
    result = await reader(skill_id="demo", relative_path="big.md")
    assert "too large" in result.get("error", "").lower()
