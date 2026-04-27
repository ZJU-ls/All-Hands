"""Regression for "trace 已不在" on sub-agent trace drawer (2026-04-27).

Root cause (first principles):
    The TraceChip in ToolCallCard pushes ``?trace=<run_id>`` and the drawer
    fetches ``/api/observatory/runs/{run_id}``. ``get_run_detail`` resolves
    by scanning the events table for ``run.*`` rows whose ``payload.run_id``
    matches. ``chat_service`` was the *only* path emitting those events —
    sub-agent runs spawned via ``DispatchService`` and ``SpawnSubagentService``
    bypassed it, so their ``run_id`` was never written anywhere observable
    and the drawer always 404'd.

    Fix: both services now accept an ``event_bus`` and emit
    ``run.started`` + ``run.completed/failed`` around the inner runner stream.

This test pins the contract so the regression cannot return silently.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import pytest

from allhands.core import Employee
from allhands.execution.dispatch import (
    DispatchService,
    _parent_conversation_id,
)
from allhands.execution.tools.meta.spawn_subagent import SpawnSubagentService


@dataclass
class _StubEvent:
    kind: str
    delta: str = ""
    message: str = ""


@dataclass
class _RecordedPublish:
    kind: str
    payload: dict[str, Any]


class _RecordingBus:
    """Minimal EventBus stand-in — captures publish_best_effort calls."""

    def __init__(self) -> None:
        self.calls: list[_RecordedPublish] = field(default_factory=list)  # type: ignore[assignment]
        self.calls = []

    def publish_best_effort(
        self,
        kind: str,
        payload: dict[str, Any] | None = None,
        trigger_id: str | None = None,
    ) -> None:
        self.calls.append(_RecordedPublish(kind=kind, payload=payload or {}))


class _OkRunner:
    def stream(self, messages: list[dict[str, Any]], thread_id: str) -> AsyncIterator[Any]:
        async def _gen() -> AsyncIterator[Any]:
            yield _StubEvent(kind="token", delta="hello")

        return _gen()


class _ErrRunner:
    def stream(self, messages: list[dict[str, Any]], thread_id: str) -> AsyncIterator[Any]:
        async def _gen() -> AsyncIterator[Any]:
            yield _StubEvent(kind="error", message="boom")

        return _gen()


class _FakeEmployeeRepo:
    def __init__(self, e: Employee) -> None:
        self._e = e

    async def get(self, employee_id: str) -> Employee | None:
        return self._e if employee_id == self._e.id else None


def _mk_employee() -> Employee:
    return Employee(
        id=str(uuid.uuid4()),
        name="Worker",
        description="",
        system_prompt="be helpful",
        model_ref="openai/gpt-4o-mini",
        tool_ids=[],
        skill_ids=[],
        max_iterations=5,
        created_by="user",
        created_at=datetime.now(UTC),
    )


@pytest.mark.asyncio
async def test_dispatch_emits_run_started_and_completed_with_run_id() -> None:
    emp = _mk_employee()
    bus = _RecordingBus()
    svc = DispatchService(
        employee_repo=_FakeEmployeeRepo(emp),
        runner_factory=lambda c, d: _OkRunner(),
        event_bus=bus,
    )
    result = await svc.dispatch(employee_id=emp.id, task="do it")

    kinds = [c.kind for c in bus.calls]
    assert kinds == ["run.started", "run.completed"], (
        "Sub-run lifecycle events missing — observatory.get_run_detail will 404 "
        "and the trace drawer will show 'trace 已不在'."
    )

    started = bus.calls[0]
    completed = bus.calls[1]
    assert started.payload["run_id"] == result.run_id
    assert completed.payload["run_id"] == result.run_id
    assert started.payload["employee_id"] == emp.id
    assert started.payload["depth"] == 1
    assert "duration_s" in completed.payload


@pytest.mark.asyncio
async def test_dispatch_emits_run_failed_on_inner_error() -> None:
    emp = _mk_employee()
    bus = _RecordingBus()
    svc = DispatchService(
        employee_repo=_FakeEmployeeRepo(emp),
        runner_factory=lambda c, d: _ErrRunner(),
        event_bus=bus,
    )
    result = await svc.dispatch(employee_id=emp.id, task="break")
    kinds = [c.kind for c in bus.calls]
    assert kinds == ["run.started", "run.failed"]
    failed = bus.calls[1]
    assert failed.payload["run_id"] == result.run_id
    assert failed.payload["error"] == "boom"


@pytest.mark.asyncio
async def test_dispatch_inherits_parent_conversation_id_from_contextvar() -> None:
    emp = _mk_employee()
    bus = _RecordingBus()
    svc = DispatchService(
        employee_repo=_FakeEmployeeRepo(emp),
        runner_factory=lambda c, d: _OkRunner(),
        event_bus=bus,
    )
    token = _parent_conversation_id.set("conv-abc")
    try:
        await svc.dispatch(employee_id=emp.id, task="do it")
    finally:
        _parent_conversation_id.reset(token)

    started = bus.calls[0]
    assert started.payload["conversation_id"] == "conv-abc"


@pytest.mark.asyncio
async def test_dispatch_no_bus_does_not_crash() -> None:
    """Optional dependency · None bus must keep dispatch usable for tests / CLI."""
    emp = _mk_employee()
    svc = DispatchService(
        employee_repo=_FakeEmployeeRepo(emp),
        runner_factory=lambda c, d: _OkRunner(),
        event_bus=None,
    )
    result = await svc.dispatch(employee_id=emp.id, task="do it")
    assert result.status == "succeeded"


# ── spawn_subagent half ─────────────────────────────────────────────────


class _SpawnEmployeeRepo:
    async def get_by_name(self, name: str) -> None:
        return None


@pytest.mark.asyncio
async def test_spawn_subagent_emits_lifecycle_with_run_id_aliased_to_trace_id() -> None:
    """spawn_subagent uses ``trace_id`` internally but must surface it as
    ``run_id`` so the FE TraceChip detection works uniformly with
    dispatch_employee. The events stream must carry the same id."""
    bus = _RecordingBus()
    svc = SpawnSubagentService(
        employee_repo=_SpawnEmployeeRepo(),
        runner_factory=lambda c, d: _OkRunner(),  # type: ignore[arg-type]
        event_bus=bus,
    )
    out = await svc.spawn(profile="execute", task="do thing")

    # Result envelope: trace_id and run_id are the same uuid
    assert out["trace_id"] == out["run_id"]
    assert out["run_id"]

    # Two events emitted around the inner runner
    assert [c.kind for c in bus.calls] == ["run.started", "run.completed"]
    # Both carry the same run_id (== returned run_id)
    assert bus.calls[0].payload["run_id"] == out["run_id"]
    assert bus.calls[1].payload["run_id"] == out["run_id"]


@pytest.mark.asyncio
async def test_spawn_subagent_no_bus_still_returns_run_id() -> None:
    """When chat_service didn't wire a bus (test path), spawn still returns
    run_id so the FE chip renders consistently — just no events written."""
    svc = SpawnSubagentService(
        employee_repo=_SpawnEmployeeRepo(),
        runner_factory=lambda c, d: _OkRunner(),  # type: ignore[arg-type]
        event_bus=None,
    )
    out = await svc.spawn(profile="execute", task="do thing")
    assert "run_id" in out
    assert out["run_id"] == out["trace_id"]
