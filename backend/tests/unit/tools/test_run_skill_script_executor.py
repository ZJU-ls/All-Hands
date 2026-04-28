"""Executor-layer tests for run_skill_script · uses FakeScriptRunner.

Validates the gate between the LLM tool call and the runner:
- skill_id activation check (must be in runtime.resolved_skills)
- Skill must have an on-disk install path
- pydantic validation surfaces as structured envelope (ADR 0021)
- RunnerError → envelope (no leaked stack)
- Successful path returns ScriptResult dict
"""

from __future__ import annotations

import pytest

from allhands.core.skill import Skill, SkillSource
from allhands.core.skill_runtime import SkillRuntime
from allhands.core.skill_script import ScriptInterpreter, ScriptResult
from allhands.execution.script_runner import FakeScriptRunner, RunnerError
from allhands.execution.skills import SkillRegistry
from allhands.execution.tools.meta.skill_scripts import (
    RUN_SKILL_SCRIPT_TOOL,
    make_run_skill_script_executor,
)


def _make_registry(skill: Skill) -> SkillRegistry:
    """Tiny registry with one preinstalled skill · uses public register API."""
    reg = SkillRegistry()
    reg.register(skill)
    return reg


def _make_skill(skill_id: str, path: str | None = "/tmp/x") -> Skill:
    return Skill(
        id=skill_id,
        name=skill_id,
        description=f"test {skill_id}",
        version="0.0.1",
        source=SkillSource.BUILTIN,
        path=path,
    )


# ──────────────────────────────────────────────────────────────────────────
# Tool stub assertions (ADR 0021 declarative shape)
# ──────────────────────────────────────────────────────────────────────────


def test_tool_stub_is_irreversible_with_confirmation() -> None:
    assert RUN_SKILL_SCRIPT_TOOL.scope.value == "irreversible"
    assert RUN_SKILL_SCRIPT_TOOL.requires_confirmation is True


def test_tool_stub_required_fields() -> None:
    schema = RUN_SKILL_SCRIPT_TOOL.input_schema
    assert "skill_id" in schema["required"]
    assert "script" in schema["required"]


def test_tool_stub_interpreter_enum_lists_all_values() -> None:
    enum_vals = RUN_SKILL_SCRIPT_TOOL.input_schema["properties"]["interpreter"]["enum"]
    assert set(enum_vals) == {"auto", "python", "node", "bash"}


# ──────────────────────────────────────────────────────────────────────────
# Activation check
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rejects_non_string_skill_id() -> None:
    runtime = SkillRuntime()
    runner = FakeScriptRunner()
    executor = make_run_skill_script_executor(
        runtime=runtime, skill_registry=_make_registry(_make_skill("pdf")), runner=runner
    )
    out = await executor(skill_id=42, script="scripts/x.py")
    assert out["error"]
    assert out["field"] == "skill_id"


@pytest.mark.asyncio
async def test_rejects_unactivated_skill() -> None:
    runtime = SkillRuntime()  # no resolved_skills
    runner = FakeScriptRunner()
    executor = make_run_skill_script_executor(
        runtime=runtime, skill_registry=_make_registry(_make_skill("pdf")), runner=runner
    )
    out = await executor(skill_id="pdf", script="scripts/x.py")
    assert "not activated" in out["error"]
    assert out["field"] == "skill_id"
    assert "resolve_skill" in out["hint"]


@pytest.mark.asyncio
async def test_rejects_skill_without_path() -> None:
    runtime = SkillRuntime(resolved_skills={"pdf": []})
    runner = FakeScriptRunner()
    executor = make_run_skill_script_executor(
        runtime=runtime,
        skill_registry=_make_registry(_make_skill("pdf", path=None)),
        runner=runner,
    )
    out = await executor(skill_id="pdf", script="scripts/x.py")
    assert "no install path" in out["error"]


# ──────────────────────────────────────────────────────────────────────────
# Pydantic envelope on bad invocation
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_envelope_for_short_script_path() -> None:
    runtime = SkillRuntime(resolved_skills={"pdf": []})
    runner = FakeScriptRunner()
    executor = make_run_skill_script_executor(
        runtime=runtime, skill_registry=_make_registry(_make_skill("pdf")), runner=runner
    )
    out = await executor(skill_id="pdf", script="scripts/")  # too short
    assert "error" in out
    # field is the pydantic loc joined with '.'
    assert out.get("field") == "script"


@pytest.mark.asyncio
async def test_envelope_for_oversize_timeout() -> None:
    runtime = SkillRuntime(resolved_skills={"pdf": []})
    runner = FakeScriptRunner()
    executor = make_run_skill_script_executor(
        runtime=runtime, skill_registry=_make_registry(_make_skill("pdf")), runner=runner
    )
    out = await executor(skill_id="pdf", script="scripts/x.py", timeout_seconds=999)
    assert "error" in out
    assert out["field"] == "timeout_seconds"


# ──────────────────────────────────────────────────────────────────────────
# Runner happy path / error envelope
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_happy_path_returns_script_result_payload() -> None:
    runtime = SkillRuntime(resolved_skills={"pdf": []})
    expected = ScriptResult(
        exit_code=0,
        stdout="hello",
        stderr="",
        duration_ms=15,
        interpreter_used=ScriptInterpreter.PYTHON,
    )
    runner = FakeScriptRunner(result=expected)
    executor = make_run_skill_script_executor(
        runtime=runtime, skill_registry=_make_registry(_make_skill("pdf")), runner=runner
    )
    out = await executor(skill_id="pdf", script="scripts/x.py")
    assert out["exit_code"] == 0
    assert out["stdout"] == "hello"
    assert out["interpreter_used"] == "python"
    assert "killed" not in out  # None dropped
    # Runner saw the right invocation
    assert runner.last_invocation is not None
    assert runner.last_invocation.skill_id == "pdf"
    assert runner.last_invocation.script == "scripts/x.py"


@pytest.mark.asyncio
async def test_runner_error_becomes_envelope() -> None:
    runtime = SkillRuntime(resolved_skills={"pdf": []})
    runner = FakeScriptRunner(
        raises=RunnerError(
            "script not found",
            field="script",
            expected="existing file",
            received="scripts/ghost.py",
            hint="check listing",
        )
    )
    executor = make_run_skill_script_executor(
        runtime=runtime, skill_registry=_make_registry(_make_skill("pdf")), runner=runner
    )
    out = await executor(skill_id="pdf", script="scripts/ghost.py")
    assert out["error"] == "script not found"
    assert out["field"] == "script"
    assert out["hint"] == "check listing"


@pytest.mark.asyncio
async def test_unexpected_runner_crash_is_caught() -> None:
    """Defence in depth · unknown exceptions don't leak stack."""

    class _BoomRunner:
        async def run(self, *args: object, **kwargs: object) -> ScriptResult:
            raise RuntimeError("kernel panic")

    runtime = SkillRuntime(resolved_skills={"pdf": []})
    executor = make_run_skill_script_executor(
        runtime=runtime,
        skill_registry=_make_registry(_make_skill("pdf")),
        runner=_BoomRunner(),  # type: ignore[arg-type]
    )
    out = await executor(skill_id="pdf", script="scripts/x.py")
    assert "runner crashed" in out["error"]
    assert "RuntimeError" in out["error"]
    # Hint exists so the LLM can decide whether to retry
    assert "hint" in out
