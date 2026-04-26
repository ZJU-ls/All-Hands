"""Phase 2 · spawn_subagent meta tool · isolated memory + nesting cap.

Spec: docs/specs/agent-runtime-contract.md § 5.2 + § 9.2.
Issue: I-0022 Phase 2 acceptance.

Target behavior:

  - parent AgentRunner calls spawn_subagent(profile="execute", task="...")
  - ConfirmationGate fires (WRITE scope, requires_confirmation=True)
  - child AgentRunner starts with fresh memory scope (no parent history)
  - parent receives {result, trace_id, iterations_used, status}
  - v0 nesting cap: child calling spawn_subagent again errors

Reference:
  ref-src-claude/V10-multi-agent.md § 2.2 in-process AsyncLocalStorage
    isolation · each runAgent call is an isolated iframe.
  ref-src-claude/V04-tool-call-mechanism.md § 2.1 Tool scope + gate.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import pytest

from allhands.core import Employee
from allhands.execution.dispatch import current_dispatch_depth
from allhands.execution.tools.meta.spawn_subagent import (
    SPAWN_SUBAGENT_TOOL,
    SpawnSubagentService,
)


@dataclass
class _TokenEvent:
    kind: str = "token"
    delta: str = ""


@dataclass
class _DoneEvent:
    kind: str = "done"
    reason: str = "done"


class _StubRunner:
    """Canned-tokens sub-runner · records what the parent gave the child."""

    def __init__(self, tokens: list[str]) -> None:
        self._tokens = tokens
        self.received_messages: list[dict[str, Any]] = []
        self.received_thread_id: str | None = None
        self.received_employee: Employee | None = None
        self.observed_depth: int | None = None

    def stream(
        self,
        messages: list[dict[str, Any]],
        thread_id: str,
    ) -> AsyncIterator[Any]:
        self.received_messages = messages
        self.received_thread_id = thread_id
        self.observed_depth = current_dispatch_depth()
        tokens = self._tokens

        async def _gen() -> AsyncIterator[Any]:
            for t in tokens:
                yield _TokenEvent(delta=t)
            yield _DoneEvent()

        return _gen()


class _FakeEmployeeRepo:
    def __init__(self, by_id: dict[str, Employee], by_name: dict[str, Employee]) -> None:
        self._by_id = by_id
        self._by_name = by_name

    async def get(self, employee_id: str) -> Employee | None:
        return self._by_id.get(employee_id)

    async def get_by_name(self, name: str) -> Employee | None:
        return self._by_name.get(name)


def _mk_employee(name: str = "W") -> Employee:
    return Employee(
        id=str(uuid.uuid4()),
        name=name,
        description="desc",
        system_prompt="You are a worker.",
        model_ref="openai/gpt-4o-mini",
        tool_ids=["allhands.builtin.fetch_url"],
        skill_ids=[],
        max_iterations=5,
        created_by="user",
        created_at=datetime.now(UTC),
    )


# ---- Tool schema --------------------------------------------------------


def test_spawn_subagent_tool_schema() -> None:
    """Contract § 5.2 · scope=WRITE · Meta kind.

    requires_confirmation is False — spawning a child runner is benign;
    the child has its own ConfirmationGate for any real WRITE inside its
    scope. Mirrors dispatch_employee. Confirming at the spawn boundary
    is a double-gate that produces "expired by user" because the user
    never sees a meaningful prompt for it.
    """
    from allhands.core import ToolKind, ToolScope

    assert SPAWN_SUBAGENT_TOOL.id == "allhands.meta.spawn_subagent"
    assert SPAWN_SUBAGENT_TOOL.kind == ToolKind.META
    assert SPAWN_SUBAGENT_TOOL.scope == ToolScope.WRITE
    assert SPAWN_SUBAGENT_TOOL.requires_confirmation is False
    required = SPAWN_SUBAGENT_TOOL.input_schema.get("required", [])
    assert "profile" in required
    assert "task" in required


def test_spawn_subagent_registered_in_tool_registry() -> None:
    """Contract § 4.1 · plan_with_subagent preset mounts spawn_subagent · discover registers it."""
    from allhands.execution.registry import ToolRegistry
    from allhands.execution.tools import discover_builtin_tools

    tool_reg = ToolRegistry()
    discover_builtin_tools(tool_reg)
    tool, _ = tool_reg.get("allhands.meta.spawn_subagent")
    assert tool.name == "spawn_subagent"


# ---- Isolated memory ----------------------------------------------------


@pytest.mark.asyncio
async def test_spawn_subagent_child_sees_only_task_not_parent_history() -> None:
    """Contract § 5.2 behavior 3 · memory isolation · V10 AsyncLocalStorage analog."""
    captured: list[_StubRunner] = []

    def factory(child: Employee, depth: int) -> _StubRunner:
        r = _StubRunner(tokens=["child did the work"])
        captured.append(r)
        return r

    svc = SpawnSubagentService(
        employee_repo=_FakeEmployeeRepo({}, {}),
        runner_factory=factory,
    )
    result = await svc.spawn(profile="execute", task="do X")

    assert len(captured) == 1
    child = captured[0]
    # Child sees ONLY the task as its sole user message. No parent history.
    assert child.received_messages == [{"role": "user", "content": "do X"}]
    assert result["status"] == "completed"
    assert "child did the work" in result["result"]


@pytest.mark.asyncio
async def test_spawn_subagent_builds_preset_child_in_memory() -> None:
    """Contract § 5.2 behavior 2 · profile=preset → in-memory Employee with preset tools."""
    captured: list[Employee] = []

    def factory(child: Employee, depth: int) -> _StubRunner:
        captured.append(child)
        return _StubRunner(tokens=["ok"])

    svc = SpawnSubagentService(
        employee_repo=_FakeEmployeeRepo({}, {}),
        runner_factory=factory,
    )
    await svc.spawn(profile="execute", task="t")

    child = captured[0]
    # Preset 'execute' baseline tools include fetch_url + write_file + resolve_skill.
    assert "allhands.meta.resolve_skill" in child.tool_ids
    assert "allhands.builtin.fetch_url" in child.tool_ids
    assert child.max_iterations == 10  # execute preset


@pytest.mark.asyncio
async def test_spawn_subagent_loads_existing_employee_by_name() -> None:
    """profile != preset → treat as employee slug · loaded via repo.get_by_name."""
    emp = _mk_employee(name="stockbot")
    captured: list[Employee] = []

    def factory(child: Employee, depth: int) -> _StubRunner:
        captured.append(child)
        return _StubRunner(tokens=["ok"])

    svc = SpawnSubagentService(
        employee_repo=_FakeEmployeeRepo({emp.id: emp}, {emp.name: emp}),
        runner_factory=factory,
    )
    result = await svc.spawn(profile="stockbot", task="check AAPL")

    assert result["status"] == "completed"
    # Loaded from repo · preserves id (not a fresh uuid).
    assert captured[0].id == emp.id


@pytest.mark.asyncio
async def test_spawn_subagent_unknown_profile_errors() -> None:
    """Neither preset nor known employee · error status · no runner invoked."""
    called = 0

    def factory(child: Employee, depth: int) -> _StubRunner:
        nonlocal called
        called += 1
        return _StubRunner(tokens=[])

    svc = SpawnSubagentService(
        employee_repo=_FakeEmployeeRepo({}, {}),
        runner_factory=factory,
    )
    result = await svc.spawn(profile="nonexistent", task="t")

    assert result["status"] == "error"
    assert "nonexistent" in result["result"]
    assert called == 0


# ---- Nesting cap --------------------------------------------------------


@pytest.mark.asyncio
async def test_subagent_cannot_spawn_another_subagent() -> None:
    """Contract § 5.2 nesting constraint · V10 teammates cannot spawn teammates · v0 cap=1."""

    def factory(child: Employee, depth: int) -> _StubRunner:
        return _StubRunner(tokens=["nested"])

    svc = SpawnSubagentService(
        employee_repo=_FakeEmployeeRepo({}, {}),
        runner_factory=factory,
    )

    # Simulate that the current task runs inside a subagent already · depth=1.
    from allhands.execution.dispatch import _dispatch_depth

    token = _dispatch_depth.set(1)
    try:
        result = await svc.spawn(profile="execute", task="try to nest")
    finally:
        _dispatch_depth.reset(token)

    assert result["status"] == "error"
    assert "nest" in result["result"].lower() or "depth" in result["result"].lower()


@pytest.mark.asyncio
async def test_spawn_subagent_observed_depth_is_incremented_in_child() -> None:
    """Contract § 9.2 · child sees its own depth (1) when spawned by top-level (0)."""
    captured: list[_StubRunner] = []

    def factory(child: Employee, depth: int) -> _StubRunner:
        r = _StubRunner(tokens=["ok"])
        captured.append(r)
        return r

    svc = SpawnSubagentService(
        employee_repo=_FakeEmployeeRepo({}, {}),
        runner_factory=factory,
    )
    await svc.spawn(profile="execute", task="t")

    assert captured[0].observed_depth == 1


# ---- Result shape -------------------------------------------------------


@pytest.mark.asyncio
async def test_spawn_subagent_returns_contract_result_shape() -> None:
    """Contract § 5.2 output schema · result / trace_id / iterations_used / status."""

    def factory(child: Employee, depth: int) -> _StubRunner:
        return _StubRunner(tokens=["a", "b", "c"])

    svc = SpawnSubagentService(
        employee_repo=_FakeEmployeeRepo({}, {}),
        runner_factory=factory,
    )
    result = await svc.spawn(profile="execute", task="t")

    assert set(result.keys()) >= {"result", "trace_id", "iterations_used", "status"}
    assert result["status"] == "completed"
    assert result["result"] == "abc"


@pytest.mark.asyncio
async def test_spawn_subagent_max_iterations_override_is_honored() -> None:
    """Contract § 5.2 · max_iterations_override replaces preset default."""
    captured: list[Employee] = []

    def factory(child: Employee, depth: int) -> _StubRunner:
        captured.append(child)
        return _StubRunner(tokens=["x"])

    svc = SpawnSubagentService(
        employee_repo=_FakeEmployeeRepo({}, {}),
        runner_factory=factory,
    )
    await svc.spawn(profile="execute", task="t", max_iterations_override=3)

    assert captured[0].max_iterations == 3
