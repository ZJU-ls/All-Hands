"""E2E integration · resolve_skill → run_skill_script → real subprocess.

Goes through the same code path the Lead Agent will hit, end-to-end:
  1. Build a tmp skill dir with a real .py
  2. Register it in a SkillRegistry
  3. Activate via resolve_skill executor
  4. Invoke via run_skill_script executor (real SubprocessScriptRunner)
  5. Assert structured ScriptResult comes back

Plus the in-tree builtin `allhands.script_demo` skill (echo / sheet_diff /
word_count) — these are the canonical fixtures we ship with the platform
and they need to work end-to-end against the real registry too.

No LLM here · LLM-driven E2E lives in
test_run_skill_script_with_real_llm.py (gated on ANTHROPIC_API_KEY).
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from allhands.core import Employee, Skill, SkillRuntime
from allhands.core.skill_script import ScriptInterpreter
from allhands.execution.script_runner import SubprocessScriptRunner
from allhands.execution.skills import SkillRegistry, seed_skills
from allhands.execution.tools.meta.resolve_skill import make_resolve_skill_executor
from allhands.execution.tools.meta.skill_files import make_read_skill_file_executor
from allhands.execution.tools.meta.skill_scripts import make_run_skill_script_executor


@pytest.fixture
def installed_skill(tmp_path: Path) -> dict[str, object]:
    skill_dir = tmp_path / "demo"
    (skill_dir / "scripts").mkdir(parents=True)
    (skill_dir / "scripts" / "hello.py").write_text("print('e2e ok')", encoding="utf-8")
    (skill_dir / "scripts" / "json_echo.py").write_text(
        "import sys, json; print(json.dumps({'received': sys.argv[1:]}))",
        encoding="utf-8",
    )

    skill = Skill(
        id="demo",
        name="demo",
        description="e2e demo",
        tool_ids=["allhands.meta.run_skill_script"],
        prompt_fragment=None,
        version="0.1.0",
        path=str(skill_dir),
    )
    registry = SkillRegistry()
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
    return {"registry": registry, "runtime": runtime, "employee": employee, "skill_dir": skill_dir}


# ──────────────────────────────────────────────────────────────────────────
# Tmp-skill E2E: resolve → run
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_must_resolve_before_run(installed_skill: dict[str, object]) -> None:
    """Without prior resolve_skill, run_skill_script must refuse with hint."""
    registry: SkillRegistry = installed_skill["registry"]  # type: ignore[assignment]
    runtime: SkillRuntime = installed_skill["runtime"]  # type: ignore[assignment]

    run = make_run_skill_script_executor(
        runtime=runtime,
        skill_registry=registry,
        runner=SubprocessScriptRunner(),
    )
    out = await run(skill_id="demo", script="scripts/hello.py")
    assert "not activated" in out["error"]
    assert "resolve_skill" in out["hint"]


@pytest.mark.asyncio
async def test_resolve_then_run_succeeds(installed_skill: dict[str, object]) -> None:
    registry: SkillRegistry = installed_skill["registry"]  # type: ignore[assignment]
    runtime: SkillRuntime = installed_skill["runtime"]  # type: ignore[assignment]
    employee: Employee = installed_skill["employee"]  # type: ignore[assignment]

    resolve = make_resolve_skill_executor(
        employee=employee, runtime=runtime, skill_registry=registry
    )
    rs = await resolve(skill_id="demo")
    assert rs.get("ok") is True or "demo" in str(rs)
    assert "demo" in runtime.resolved_skills

    run = make_run_skill_script_executor(
        runtime=runtime,
        skill_registry=registry,
        runner=SubprocessScriptRunner(),
    )
    out = await run(skill_id="demo", script="scripts/hello.py")
    assert out["exit_code"] == 0
    assert "e2e ok" in out["stdout"]
    assert out["interpreter_used"] == "python"


@pytest.mark.asyncio
async def test_args_round_trip(installed_skill: dict[str, object]) -> None:
    registry: SkillRegistry = installed_skill["registry"]  # type: ignore[assignment]
    runtime: SkillRuntime = installed_skill["runtime"]  # type: ignore[assignment]
    employee: Employee = installed_skill["employee"]  # type: ignore[assignment]

    resolve = make_resolve_skill_executor(
        employee=employee, runtime=runtime, skill_registry=registry
    )
    await resolve(skill_id="demo")

    run = make_run_skill_script_executor(
        runtime=runtime,
        skill_registry=registry,
        runner=SubprocessScriptRunner(),
    )
    out = await run(
        skill_id="demo",
        script="scripts/json_echo.py",
        args=["alpha", "beta"],
    )
    assert out["exit_code"] == 0
    import json

    payload = json.loads(out["stdout"])
    assert payload["received"] == ["alpha", "beta"]


@pytest.mark.asyncio
async def test_read_skill_file_works_alongside(installed_skill: dict[str, object]) -> None:
    """Sanity · agent should be able to read .py source then decide to run it."""
    registry: SkillRegistry = installed_skill["registry"]  # type: ignore[assignment]
    runtime: SkillRuntime = installed_skill["runtime"]  # type: ignore[assignment]
    employee: Employee = installed_skill["employee"]  # type: ignore[assignment]

    resolve = make_resolve_skill_executor(
        employee=employee, runtime=runtime, skill_registry=registry
    )
    await resolve(skill_id="demo")

    read = make_read_skill_file_executor(runtime=runtime, skill_registry=registry)
    out = await read(skill_id="demo", relative_path="scripts/hello.py")
    assert "e2e ok" in out["content"]


# ──────────────────────────────────────────────────────────────────────────
# Built-in script_demo skill (the one we just shipped)
# ──────────────────────────────────────────────────────────────────────────


@pytest.fixture
def builtin_demo_runtime() -> dict[str, object]:
    """Use the real seeded registry · prove the in-tree skill installs cleanly."""
    registry = SkillRegistry()
    seed_skills(registry)

    skill = registry.get_full("allhands.script_demo")
    assert skill is not None, "script_demo builtin skill should be discovered"
    assert skill.path is not None
    assert "allhands.meta.run_skill_script" in skill.tool_ids

    runtime = SkillRuntime()
    employee = Employee(
        id="e1",
        name="builtin-runner",
        description="",
        system_prompt="sp",
        model_ref="p/m",
        skill_ids=["allhands.script_demo"],
        tool_ids=[],
        created_by="u1",
        created_at=datetime.now(UTC),
    )
    return {"registry": registry, "runtime": runtime, "employee": employee}


@pytest.mark.asyncio
async def test_builtin_echo_script(builtin_demo_runtime: dict[str, object]) -> None:
    registry: SkillRegistry = builtin_demo_runtime["registry"]  # type: ignore[assignment]
    runtime: SkillRuntime = builtin_demo_runtime["runtime"]  # type: ignore[assignment]
    employee: Employee = builtin_demo_runtime["employee"]  # type: ignore[assignment]

    resolve = make_resolve_skill_executor(
        employee=employee, runtime=runtime, skill_registry=registry
    )
    await resolve(skill_id="allhands.script_demo")

    run = make_run_skill_script_executor(
        runtime=runtime,
        skill_registry=registry,
        runner=SubprocessScriptRunner(),
    )
    out = await run(
        skill_id="allhands.script_demo",
        script="scripts/echo.py",
        args=["hello", "world"],
    )
    assert out["exit_code"] == 0
    assert "hello world" in out["stdout"]


@pytest.mark.asyncio
async def test_builtin_word_count_via_stdin(
    builtin_demo_runtime: dict[str, object],
) -> None:
    registry: SkillRegistry = builtin_demo_runtime["registry"]  # type: ignore[assignment]
    runtime: SkillRuntime = builtin_demo_runtime["runtime"]  # type: ignore[assignment]
    employee: Employee = builtin_demo_runtime["employee"]  # type: ignore[assignment]

    resolve = make_resolve_skill_executor(
        employee=employee, runtime=runtime, skill_registry=registry
    )
    await resolve(skill_id="allhands.script_demo")

    run = make_run_skill_script_executor(
        runtime=runtime,
        skill_registry=registry,
        runner=SubprocessScriptRunner(),
    )
    out = await run(
        skill_id="allhands.script_demo",
        script="scripts/word_count.py",
        stdin="one two three\nfour five\n",
    )
    assert out["exit_code"] == 0
    import json

    payload = json.loads(out["stdout"])
    assert payload == {"lines": 2, "words": 5, "chars": len("one two three\nfour five\n")}


@pytest.mark.asyncio
async def test_builtin_sheet_diff_against_csv(
    builtin_demo_runtime: dict[str, object],
    tmp_path: Path,
) -> None:
    """End-to-end · the script reads CSV files we drop in tmp_path.

    Demonstrates the complete loop the user expects:
      - skill bundles the script + decision logic
      - agent passes file paths via args
      - script reads stdlib · prints structured JSON
      - tool serializes ScriptResult back to LLM-friendly dict
    """
    a = tmp_path / "q1.csv"
    b = tmp_path / "q2.csv"
    a.write_text("id,amount\n1,100\n2,200\n3,300\n", encoding="utf-8")
    b.write_text("id,amount\n1,150\n3,300\n4,400\n", encoding="utf-8")

    registry: SkillRegistry = builtin_demo_runtime["registry"]  # type: ignore[assignment]
    runtime: SkillRuntime = builtin_demo_runtime["runtime"]  # type: ignore[assignment]
    employee: Employee = builtin_demo_runtime["employee"]  # type: ignore[assignment]

    resolve = make_resolve_skill_executor(
        employee=employee, runtime=runtime, skill_registry=registry
    )
    await resolve(skill_id="allhands.script_demo")

    run = make_run_skill_script_executor(
        runtime=runtime,
        skill_registry=registry,
        runner=SubprocessScriptRunner(),
    )
    out = await run(
        skill_id="allhands.script_demo",
        script="scripts/sheet_diff.py",
        args=[str(a), str(b), "--key", "id", "--threshold", "0.2"],
    )
    assert out["exit_code"] == 0, out
    import json

    payload = json.loads(out["stdout"])

    added_keys = {row["key"] for row in payload["added"]}
    removed_keys = {row["key"] for row in payload["removed"]}
    changed = {(row["key"], row["field"]): row for row in payload["changed"]}

    assert added_keys == {"4"}
    assert removed_keys == {"2"}
    # id 1 went 100 → 150 = +50% > threshold 20% → reported
    assert ("1", "amount") in changed
    assert changed[("1", "amount")]["pct"] == 0.5


# ──────────────────────────────────────────────────────────────────────────
# Confirmation Gate semantics — the tool stub itself
# ──────────────────────────────────────────────────────────────────────────


def test_run_skill_script_tool_is_irreversible() -> None:
    """Hard guarantee: never silently runs · always Confirmation Gate."""
    from allhands.execution.tools.meta.skill_scripts import RUN_SKILL_SCRIPT_TOOL

    assert RUN_SKILL_SCRIPT_TOOL.scope.value == "irreversible"
    assert RUN_SKILL_SCRIPT_TOOL.requires_confirmation is True


def test_run_skill_script_in_tool_registry() -> None:
    """L01: tool is registered in the global discover_builtin_tools pipeline."""
    from allhands.execution.registry import ToolRegistry
    from allhands.execution.tools import discover_builtin_tools
    from allhands.execution.tools.meta.skill_scripts import RUN_SKILL_SCRIPT_TOOL_ID

    reg = ToolRegistry()
    discover_builtin_tools(reg)
    tools = reg.list_all()
    ids = {t.id for t in tools}
    assert RUN_SKILL_SCRIPT_TOOL_ID in ids


def test_interpreter_pin_overrides_extension(installed_skill: dict[str, object]) -> None:
    """Sanity · pinned interpreter wins regardless of script's name."""
    from allhands.core.skill_script import ScriptInvocation

    inv = ScriptInvocation(
        skill_id="x",
        script="scripts/looks_like.exe",
        interpreter=ScriptInterpreter.PYTHON,
    )
    assert inv.resolved_interpreter() is ScriptInterpreter.PYTHON
