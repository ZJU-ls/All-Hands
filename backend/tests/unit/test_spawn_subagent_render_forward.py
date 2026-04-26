"""Sub-agent render envelope must bubble to parent chat (regression).

User-visible bug 2026-04-26: when a sub-agent (spawn_subagent path) called
render_drawio / artifact_create_*, the artifact persisted but the parent
chat showed no card. Root cause: ``_drive`` only collected ``token`` /
``error`` events, dropping ``render`` events on the floor — so the
spawn_subagent tool result was a plain string, not a render envelope, and
``_as_render_envelope`` had nothing to detect on the parent side.

This test pins the forwarding contract: any render envelope from the
sub-stream must surface as ``{component, props, interactions}`` on the
spawn_subagent tool return.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

import pytest

from allhands.core import Employee
from allhands.execution.tools.meta.spawn_subagent import SpawnSubagentService


class _FakeRenderEvent:
    kind = "render"

    def __init__(self, payload: Any) -> None:
        self.payload = payload


class _FakeTokenEvent:
    kind = "token"

    def __init__(self, delta: str) -> None:
        self.delta = delta


class _FakePayload:
    """Stand-in for RenderPayload — only needs model_dump()."""

    def __init__(self, component: str, props: dict[str, Any]) -> None:
        self._d = {
            "component": component,
            "props": props,
            "interactions": [],
        }

    def model_dump(self) -> dict[str, Any]:
        return self._d


class _FakeRunner:
    """Stream a token + a render envelope from a fake inner runner."""

    def __init__(self, events: list[Any]) -> None:
        self._events = events

    async def stream(
        self, *, messages: list[dict[str, Any]], thread_id: str
    ) -> AsyncIterator[Any]:
        for ev in self._events:
            yield ev


class _FakeEmployeeRepo:
    async def get_by_name(self, name: str) -> None:  # pragma: no cover - unused path
        return None


def _employee() -> Employee:
    return Employee(
        id="emp-1",
        name="tester",
        description="t",
        system_prompt="t",
        model_ref="m",
        tool_ids=[],
        skill_ids=[],
        max_iterations=8,
        created_by="user",
        created_at=datetime.now(UTC),
    )


@pytest.mark.asyncio
async def test_spawn_subagent_forwards_render_envelope_to_parent() -> None:
    payload = _FakePayload(
        component="Artifact.Preview",
        props={"artifact_id": "abc-123", "version": 1, "kind": "drawio"},
    )
    fake = _FakeRunner(
        events=[
            _FakeTokenEvent("画好了。"),
            _FakeRenderEvent(payload),
        ]
    )

    def runner_factory(child: Employee, depth: int) -> _FakeRunner:
        return fake

    service = SpawnSubagentService(
        employee_repo=_FakeEmployeeRepo(),
        runner_factory=runner_factory,  # type: ignore[arg-type]
    )

    out = await service.spawn(profile="execute", task="画 drawio")

    # Render envelope surfaces at top level so _as_render_envelope picks
    # it up on the parent runner.
    assert out["component"] == "Artifact.Preview"
    assert out["props"] == {"artifact_id": "abc-123", "version": 1, "kind": "drawio"}
    assert out["interactions"] == []
    # Original result text is still there for the LLM to chain on.
    assert "画好了。" in out["result"]
    assert out["status"] == "completed"


@pytest.mark.asyncio
async def test_spawn_subagent_no_render_returns_plain_text() -> None:
    fake = _FakeRunner(events=[_FakeTokenEvent("纯文本回复")])

    def runner_factory(child: Employee, depth: int) -> _FakeRunner:
        return fake

    service = SpawnSubagentService(
        employee_repo=_FakeEmployeeRepo(),
        runner_factory=runner_factory,  # type: ignore[arg-type]
    )

    out = await service.spawn(profile="execute", task="说点啥")
    assert out["result"] == "纯文本回复"
    # No envelope when sub-agent didn't produce a render
    assert "component" not in out


@pytest.mark.asyncio
async def test_spawn_subagent_multiple_renders_keeps_first_in_main_envelope() -> None:
    p1 = _FakePayload("Artifact.Preview", {"artifact_id": "first"})
    p2 = _FakePayload("Artifact.Card", {"artifact_id": "second"})
    fake = _FakeRunner(events=[_FakeRenderEvent(p1), _FakeRenderEvent(p2)])

    def runner_factory(child: Employee, depth: int) -> _FakeRunner:
        return fake

    service = SpawnSubagentService(
        employee_repo=_FakeEmployeeRepo(),
        runner_factory=runner_factory,  # type: ignore[arg-type]
    )

    out = await service.spawn(profile="execute", task="画俩")
    assert out["component"] == "Artifact.Preview"
    assert out["props"]["artifact_id"] == "first"
    # Extra envelopes parked for future fan-out
    assert "extra_renders" in out
    assert len(out["extra_renders"]) == 1
    assert out["extra_renders"][0]["props"]["artifact_id"] == "second"
