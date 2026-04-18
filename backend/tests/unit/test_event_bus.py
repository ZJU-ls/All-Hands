"""Unit tests · execution/event_bus.py.

Contract (triggers spec § 4):
- publish() builds EventEnvelope, awaits persist, fans out to matching subs
- pattern matching: strict kind + field equality + _pattern glob
- handler exceptions are swallowed (bus keeps going)
- unsubscribe removes handler
- persist callback failure propagates (event did not happen)
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import pytest

from allhands.core import EventEnvelope, EventPattern
from allhands.execution.event_bus import EventBus, matches_event_pattern


def _env(kind: str, payload: dict[str, object] | None = None) -> EventEnvelope:
    return EventEnvelope(
        id="evt_test",
        kind=kind,
        payload=payload or {},
        published_at=datetime.now(UTC),
    )


def test_matcher_kind_strict_equality() -> None:
    assert matches_event_pattern(EventPattern(type="run.started"), _env("run.started"))
    assert not matches_event_pattern(EventPattern(type="run.started"), _env("run.completed"))


def test_matcher_field_equality() -> None:
    p = EventPattern(type="run.started", filter={"employee_id": "writer"})
    assert matches_event_pattern(p, _env("run.started", {"employee_id": "writer"}))
    assert not matches_event_pattern(p, _env("run.started", {"employee_id": "coder"}))
    # missing field → no match
    assert not matches_event_pattern(p, _env("run.started", {}))


def test_matcher_pattern_glob() -> None:
    p = EventPattern(
        type="artifact.updated",
        filter={"name_pattern": "**/CHANGELOG*"},
    )
    assert matches_event_pattern(p, _env("artifact.updated", {"name": "docs/CHANGELOG.md"}))
    assert not matches_event_pattern(p, _env("artifact.updated", {"name": "README.md"}))


def test_matcher_pattern_glob_requires_string_field() -> None:
    p = EventPattern(type="x", filter={"name_pattern": "*"})
    # non-string field should not match
    assert not matches_event_pattern(p, _env("x", {"name": 42}))


@pytest.mark.asyncio
async def test_publish_persists_and_dispatches() -> None:
    persisted: list[EventEnvelope] = []

    async def persist(env: EventEnvelope) -> None:
        persisted.append(env)

    bus = EventBus(persist=persist)
    received: list[EventEnvelope] = []

    async def handler(env: EventEnvelope) -> None:
        received.append(env)

    bus.subscribe(EventPattern(type="run.started"), handler)
    env = await bus.publish("run.started", {"run_id": "r1"})
    # give the background task a chance to run
    await asyncio.sleep(0)
    await asyncio.sleep(0)

    assert len(persisted) == 1
    assert persisted[0].id == env.id
    assert len(received) == 1
    assert received[0].payload["run_id"] == "r1"


@pytest.mark.asyncio
async def test_publish_no_persist_ok() -> None:
    bus = EventBus()  # no persist callback
    env = await bus.publish("any.kind", {"x": 1})
    assert env.kind == "any.kind"


@pytest.mark.asyncio
async def test_non_matching_subscriber_not_invoked() -> None:
    bus = EventBus()
    hits: list[str] = []

    async def h(env: EventEnvelope) -> None:
        hits.append(env.kind)

    bus.subscribe(EventPattern(type="run.completed"), h)
    await bus.publish("run.started")
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert hits == []


@pytest.mark.asyncio
async def test_handler_exception_swallowed() -> None:
    bus = EventBus()
    calls: list[str] = []

    async def bad(env: EventEnvelope) -> None:
        calls.append("bad")
        raise RuntimeError("boom")

    async def good(env: EventEnvelope) -> None:
        calls.append("good")

    bus.subscribe(EventPattern(type="x"), bad)
    bus.subscribe(EventPattern(type="x"), good)
    await bus.publish("x")
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert "good" in calls  # good still ran despite bad raising
    assert "bad" in calls


@pytest.mark.asyncio
async def test_unsubscribe_removes_handler() -> None:
    bus = EventBus()
    hits: list[str] = []

    async def h(env: EventEnvelope) -> None:
        hits.append("hit")

    unsub = bus.subscribe(EventPattern(type="x"), h)
    unsub()
    await bus.publish("x")
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    assert hits == []


@pytest.mark.asyncio
async def test_persist_failure_propagates() -> None:
    async def persist(env: EventEnvelope) -> None:
        raise RuntimeError("db down")

    bus = EventBus(persist=persist)
    with pytest.raises(RuntimeError, match="db down"):
        await bus.publish("x")
