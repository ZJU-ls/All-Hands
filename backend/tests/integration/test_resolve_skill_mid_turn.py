"""Phase 1 · dynamic skill injection via resolve_skill meta tool.

Spec: docs/specs/agent-runtime-contract.md § 5.1 + § 8.3.
Issue: I-0022 Phase 1 acceptance criterion.

Target behavior:

  turn 0:
    - employee has skill_ids = ["sk_research"] (not yet resolved)
    - runtime has only base tools + resolve_skill + skill_descriptors
  resolve_skill("sk_research"):
    - runner injects fetch_url into runtime.resolved_skills
    - appends sk_research prompt fragment to runtime.resolved_fragments
  turn 1 rebuild:
    - lc_tools include fetch_url
    - system prompt contains sk_research fragment

Ref: ref-src-claude/V05-skills-system.md § 2.3 · per-command lazy prompt load.
Ref: ref-src-claude/V02-execution-kernel.md § 2.1 · while(true) per-turn rebuild.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from allhands.core import Employee
from allhands.execution.registry import ToolRegistry
from allhands.execution.skills import (
    SkillRegistry,
    bootstrap_employee_runtime,
    seed_skills,
)
from allhands.execution.tools import discover_builtin_tools
from allhands.execution.tools.meta.resolve_skill import (
    RESOLVE_SKILL_TOOL,
    make_resolve_skill_executor,
)


def _emp(skill_ids: list[str], tool_ids: list[str] | None = None) -> Employee:
    return Employee(
        id="e1",
        name="e1",
        description="",
        system_prompt="base",
        model_ref="openai/gpt-4o-mini",
        tool_ids=tool_ids or ["allhands.meta.resolve_skill"],
        skill_ids=skill_ids,
        created_by="user",
        created_at=datetime.now(UTC),
    )


def _build_harness(
    skill_ids: list[str],
) -> tuple[
    Employee,
    SkillRegistry,
    ToolRegistry,
    object,
]:
    tool_reg = ToolRegistry()
    discover_builtin_tools(tool_reg)
    skill_reg = SkillRegistry()
    seed_skills(skill_reg)
    emp = _emp(skill_ids=skill_ids)
    runtime = bootstrap_employee_runtime(emp, skill_reg, tool_reg)
    return emp, skill_reg, tool_reg, runtime


@pytest.mark.asyncio
async def test_resolve_skill_injects_tools_next_turn() -> None:
    """Contract § 8.3: resolve_skill mutates runtime → next lc_tools rebuild sees fetch_url."""
    emp, skill_reg, _tool_reg, runtime = _build_harness(skill_ids=["sk_research"])
    executor = make_resolve_skill_executor(employee=emp, runtime=runtime, skill_registry=skill_reg)

    assert runtime.resolved_skills == {}
    assert runtime.resolved_fragments == []

    result = await executor(skill_id="sk_research")

    assert result["already_loaded"] is False
    assert "allhands.builtin.fetch_url" in result["tool_ids"]
    assert "researcher" in result["prompt_fragment"].lower()
    # Runtime now carries the injection; the agent_runner per-turn rebuild
    # will see it.
    assert runtime.resolved_skills["sk_research"] == ["allhands.builtin.fetch_url"]
    assert len(runtime.resolved_fragments) == 1
    assert "cite" in runtime.resolved_fragments[0].lower()


@pytest.mark.asyncio
async def test_resolve_skill_idempotent() -> None:
    """Contract § 5.1 · behavior 5: same skill_id twice → already_loaded=True · no duplicate injection."""
    emp, skill_reg, _tool_reg, runtime = _build_harness(skill_ids=["sk_research"])
    executor = make_resolve_skill_executor(employee=emp, runtime=runtime, skill_registry=skill_reg)

    await executor(skill_id="sk_research")
    result = await executor(skill_id="sk_research")

    assert result["already_loaded"] is True
    # No duplicate tool_ids or fragment.
    assert runtime.resolved_skills["sk_research"] == ["allhands.builtin.fetch_url"]
    assert len(runtime.resolved_fragments) == 1


@pytest.mark.asyncio
async def test_resolve_skill_whitelist_enforced() -> None:
    """Contract § 5.1 · behavior 1: skill_id ∉ employee.skill_ids → error · no side effect."""
    emp, skill_reg, _tool_reg, runtime = _build_harness(skill_ids=["sk_research"])
    executor = make_resolve_skill_executor(employee=emp, runtime=runtime, skill_registry=skill_reg)

    result = await executor(skill_id="sk_write")

    assert "error" in result
    # Runtime untouched.
    assert runtime.resolved_skills == {}
    assert runtime.resolved_fragments == []


@pytest.mark.asyncio
async def test_resolve_skill_unknown_skill_errors_without_mutation() -> None:
    """Defensive: skill_id in employee whitelist but missing from registry → error path."""
    tool_reg = ToolRegistry()
    discover_builtin_tools(tool_reg)
    skill_reg = SkillRegistry()  # empty registry
    emp = _emp(skill_ids=["sk_missing"])
    runtime = bootstrap_employee_runtime(emp, skill_reg, tool_reg)
    executor = make_resolve_skill_executor(employee=emp, runtime=runtime, skill_registry=skill_reg)

    result = await executor(skill_id="sk_missing")

    assert "error" in result
    assert runtime.resolved_skills == {}


def test_resolve_skill_tool_schema() -> None:
    """Contract § 5.1 · tool scope READ · no gate · Meta kind."""
    from allhands.core import ToolKind, ToolScope

    assert RESOLVE_SKILL_TOOL.id == "allhands.meta.resolve_skill"
    assert RESOLVE_SKILL_TOOL.kind == ToolKind.META
    assert RESOLVE_SKILL_TOOL.scope == ToolScope.READ
    assert RESOLVE_SKILL_TOOL.requires_confirmation is False
    # skill_id is the sole required input.
    required = RESOLVE_SKILL_TOOL.input_schema.get("required", [])
    assert required == ["skill_id"]


def test_resolve_skill_registered_in_tool_registry() -> None:
    """Contract § 4.1 · preset.execute mounts resolve_skill by default · discover must register it."""
    tool_reg = ToolRegistry()
    discover_builtin_tools(tool_reg)
    tool, _ = tool_reg.get("allhands.meta.resolve_skill")
    assert tool.name == "resolve_skill"


@pytest.mark.asyncio
async def test_resolve_skill_then_rebuild_lc_tools_includes_injected_tool() -> None:
    """Turn 2 rebuild semantics · contract § 8.2.

    After resolve_skill mutates runtime, the set `base_tool_ids` unioned
    with flatten(resolved_skills.values()) is what the next turn's
    create_react_agent is built over.
    """
    emp, skill_reg, tool_reg, runtime = _build_harness(skill_ids=["sk_research"])
    executor = make_resolve_skill_executor(employee=emp, runtime=runtime, skill_registry=skill_reg)
    await executor(skill_id="sk_research")

    # Simulate per-turn rebuild (same logic AgentRunner uses).
    active_ids: list[str] = list(runtime.base_tool_ids)
    for tids in runtime.resolved_skills.values():
        for tid in tids:
            if tid not in active_ids:
                active_ids.append(tid)

    assert "allhands.builtin.fetch_url" in active_ids
    # Confirm the registry actually has that tool (closing the loop).
    tool, _ = tool_reg.get("allhands.builtin.fetch_url")
    assert tool.name == "fetch_url"
