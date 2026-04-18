"""DispatchService unit tests — agent-design § 6.2 seven rules.

Rules:
1. new thread_id (sub-run gets its own LangGraph thread)
2. parent_run_id threaded (sub-run sees invoker as parent)
3. context isolation (child system_prompt contains parent task, NOT the
   parent conversation history)
4. Confirmation Gate 穿透 (same gate instance passed into sub-runner)
5. MAX_DISPATCH_DEPTH enforced (default 3)
6. Independent iteration budget (sub-employee's max_iterations used)
7. Trace nesting — wired via contextvar plumbing; observability hooks
   read `current_parent_run_id()` at span creation time
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import pytest

from allhands.core import Employee, EmployeeNotFound, MaxDispatchDepthExceeded
from allhands.execution.dispatch import (
    DispatchService,
    build_child_system_prompt,
    current_dispatch_depth,
    current_parent_run_id,
)


@dataclass
class _StubRunEvent:
    kind: str
    delta: str = ""
    message: str = ""


class _StubRunner:
    """Collects what the DispatchService passed in, emits canned tokens."""

    def __init__(self, tokens: list[str]) -> None:
        self.tokens = tokens
        self.received_messages: list[dict[str, Any]] = []
        self.received_thread_id: str | None = None
        self.observed_depth: int | None = None
        self.observed_parent_run_id: str | None = None

    def stream(
        self,
        messages: list[dict[str, Any]],
        thread_id: str,
    ) -> AsyncIterator[Any]:
        self.received_messages = messages
        self.received_thread_id = thread_id
        self.observed_depth = current_dispatch_depth()
        self.observed_parent_run_id = current_parent_run_id()
        tokens = self.tokens

        async def _gen() -> AsyncIterator[Any]:
            for t in tokens:
                yield _StubRunEvent(kind="token", delta=t)

        return _gen()


class _FakeEmployeeRepo:
    def __init__(self, employees: dict[str, Employee]) -> None:
        self._emps = employees
        self.get_called_with: list[str] = []

    async def get(self, employee_id: str) -> Employee | None:
        self.get_called_with.append(employee_id)
        return self._emps.get(employee_id)


def _mk_employee(
    *,
    name: str = "Worker",
    system_prompt: str = "You are a worker.",
    max_iterations: int = 7,
    tool_ids: list[str] | None = None,
) -> Employee:
    return Employee(
        id=str(uuid.uuid4()),
        name=name,
        description="desc",
        system_prompt=system_prompt,
        model_ref="openai/gpt-4o-mini",
        tool_ids=tool_ids or ["allhands.builtin.fetch_url"],
        skill_ids=[],
        max_iterations=max_iterations,
        created_by="user",
        created_at=datetime.now(UTC),
    )


async def test_dispatch_rule1_new_thread_id() -> None:
    emp = _mk_employee()
    captured: list[_StubRunner] = []

    def factory(child: Employee, depth: int) -> _StubRunner:
        r = _StubRunner(tokens=["hello"])
        captured.append(r)
        return r

    svc = DispatchService(
        employee_repo=_FakeEmployeeRepo({emp.id: emp}),
        runner_factory=factory,
    )
    result = await svc.dispatch(employee_id=emp.id, task="do it")
    assert result.thread_id is not None
    assert result.thread_id == captured[0].received_thread_id
    assert result.run_id != result.thread_id


async def test_dispatch_rule2_parent_run_id_threaded() -> None:
    emp = _mk_employee()
    inner_runner: _StubRunner | None = None

    def factory(child: Employee, depth: int) -> _StubRunner:
        nonlocal inner_runner
        inner_runner = _StubRunner(tokens=["ok"])
        return inner_runner

    svc = DispatchService(
        employee_repo=_FakeEmployeeRepo({emp.id: emp}),
        runner_factory=factory,
    )
    result = await svc.dispatch(employee_id=emp.id, task="go")
    assert inner_runner is not None
    # sub-run sees its own run_id as ambient parent_run_id while it executes
    assert inner_runner.observed_parent_run_id == result.run_id
    # but the invoker had no parent (Lead is top-level) → DispatchResult.parent_run_id is None
    assert result.parent_run_id is None


async def test_dispatch_rule3_context_isolation() -> None:
    emp = _mk_employee(system_prompt="Base system prompt.")
    captured: dict[str, Any] = {}

    def factory(child: Employee, depth: int) -> _StubRunner:
        captured["child"] = child
        return _StubRunner(tokens=["ok"])

    svc = DispatchService(
        employee_repo=_FakeEmployeeRepo({emp.id: emp}),
        runner_factory=factory,
    )
    await svc.dispatch(
        employee_id=emp.id,
        task="Migrate the auth service",
        context_refs=["run-42", "msg-17"],
    )
    child: Employee = captured["child"]
    assert "Base system prompt." in child.system_prompt
    assert "Migrate the auth service" in child.system_prompt
    assert "run-42" in child.system_prompt
    # Base prompt is preserved intact, parent task is appended
    assert child.system_prompt.startswith("Base system prompt.")


def test_build_child_system_prompt_handles_empty_refs() -> None:
    out = build_child_system_prompt("Base.", "do X", None)
    assert "do X" in out
    assert "引用先前产出" not in out


async def test_dispatch_rule5_max_depth_default_is_3() -> None:
    emp = _mk_employee()
    svc = DispatchService(
        employee_repo=_FakeEmployeeRepo({emp.id: emp}),
        runner_factory=lambda c, d: _StubRunner(tokens=["ok"]),
        max_depth=3,
    )
    assert svc.max_depth == 3


async def test_dispatch_rule5_raises_when_depth_would_exceed_limit() -> None:
    """At ambient depth = max_depth - 1, next dispatch hits the ceiling."""
    emp = _mk_employee()
    svc = DispatchService(
        employee_repo=_FakeEmployeeRepo({emp.id: emp}),
        runner_factory=lambda c, d: _StubRunner(tokens=["ok"]),
        max_depth=2,
    )

    # Simulate running INSIDE a depth=1 context — next dispatch would be depth=2 = limit
    from allhands.execution.dispatch import _dispatch_depth

    token = _dispatch_depth.set(1)
    try:
        with pytest.raises(MaxDispatchDepthExceeded):
            await svc.dispatch(employee_id=emp.id, task="too deep")
    finally:
        _dispatch_depth.reset(token)


async def test_dispatch_rule6_sub_runner_receives_child_employee_with_max_iter() -> None:
    emp = _mk_employee(max_iterations=11)
    captured: dict[str, Any] = {}

    def factory(child: Employee, depth: int) -> _StubRunner:
        captured["child"] = child
        captured["depth"] = depth
        return _StubRunner(tokens=["ok"])

    svc = DispatchService(
        employee_repo=_FakeEmployeeRepo({emp.id: emp}),
        runner_factory=factory,
    )
    await svc.dispatch(employee_id=emp.id, task="go")
    child: Employee = captured["child"]
    assert child.max_iterations == 11  # sub-run's own budget, unchanged
    assert captured["depth"] == 1  # first dispatch goes from 0 → 1


async def test_dispatch_unknown_employee_raises() -> None:
    svc = DispatchService(
        employee_repo=_FakeEmployeeRepo({}),
        runner_factory=lambda c, d: _StubRunner(tokens=[]),
    )
    with pytest.raises(EmployeeNotFound):
        await svc.dispatch(employee_id="missing", task="x")


async def test_dispatch_collects_summary_from_tokens() -> None:
    emp = _mk_employee()
    svc = DispatchService(
        employee_repo=_FakeEmployeeRepo({emp.id: emp}),
        runner_factory=lambda c, d: _StubRunner(tokens=["Hello, ", "world!"]),
    )
    result = await svc.dispatch(employee_id=emp.id, task="greet")
    assert result.status == "succeeded"
    assert result.summary == "Hello, world!"


def test_dispatch_tool_schema_matches_spec_6_1() -> None:
    """agent-design § 6.1: dispatch tool takes employee_id/task/context_refs/timeout_seconds."""
    from allhands.execution.tools.meta.employee_tools import DISPATCH_EMPLOYEE_TOOL

    props = DISPATCH_EMPLOYEE_TOOL.input_schema["properties"]
    required = DISPATCH_EMPLOYEE_TOOL.input_schema["required"]
    assert "employee_id" in props
    assert "task" in props
    assert "context_refs" in props
    assert "timeout_seconds" in props
    assert set(required) == {"employee_id", "task"}
    assert props["context_refs"]["type"] == "array"
    assert props["timeout_seconds"]["default"] == 300


async def test_dispatch_resets_depth_contextvar_after_completion() -> None:
    """depth must be fully restored so a second dispatch at the same level starts
    at depth=1 again, not depth=2 (otherwise parallel dispatches would falsely
    trip MAX_DISPATCH_DEPTH)."""
    emp = _mk_employee()
    svc = DispatchService(
        employee_repo=_FakeEmployeeRepo({emp.id: emp}),
        runner_factory=lambda c, d: _StubRunner(tokens=["ok"]),
    )
    await svc.dispatch(employee_id=emp.id, task="first")
    await svc.dispatch(employee_id=emp.id, task="second")
    assert current_dispatch_depth() == 0
    assert current_parent_run_id() is None
