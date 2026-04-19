"""I-0005 regression — artifact_changed fan-out.

Covers the full pipeline: ``ArtifactService.create/update/delete/set_pinned``
publishes an ``artifact_changed`` envelope on the in-process ``EventBus``, and
the ``/api/artifacts/stream`` SSE endpoint forwards it.

Two layers:

1. **Service → bus.** Drive the service with a real ``EventBus`` and assert a
   matching envelope lands on a subscriber for each write path (create, update,
   delete, pin). This is the core contract — the chat SSE stream and the
   dedicated ``/stream`` endpoint both rely on these envelopes being published.

2. **Bus → SSE.** Drive the router's ``event_stream`` coroutine directly so we
   exercise the SSE framing logic without the ``TestClient`` + ``aiosqlite`` +
   chunked-response deadlock that forces ``cockpit.stream`` to be skipped
   (see ``test_cockpit_api.py::test_stream_first_frame_is_snapshot``).

Spec anchors:

- ``docs/specs/agent-design/2026-04-18-artifacts-skill.md`` § 7 + DoD — "agent
  create → panel realtime".
- ``docs/issues/closed/I-0005-artifact-changed-sse-missing.md`` — suggested fix.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator, Callable
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from allhands.core import ArtifactKind, EventEnvelope
from allhands.execution.event_bus import EventBus
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlArtifactRepo
from allhands.services.artifact_service import ArtifactService


@pytest.fixture
async def session_maker() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
def bus() -> EventBus:
    return EventBus()


@pytest.fixture
def received(bus: EventBus) -> list[EventEnvelope]:
    sink: list[EventEnvelope] = []

    async def _on_event(env: EventEnvelope) -> None:
        sink.append(env)

    bus.subscribe_all(_on_event)
    return sink


async def _wait_for(predicate: Callable[[], bool], deadline_s: float = 1.0) -> None:
    """Let the bus's fire-and-forget dispatch tasks run before asserting."""
    cutoff = asyncio.get_event_loop().time() + deadline_s
    while not predicate():
        if asyncio.get_event_loop().time() > cutoff:
            raise AssertionError("timed out waiting for bus handler")
        await asyncio.sleep(0.01)


# ---------------------------------------------------------------------------
# Layer 1 — service writes publish artifact_changed envelopes
# ---------------------------------------------------------------------------


async def test_create_publishes_artifact_changed(
    session_maker: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    bus: EventBus,
    received: list[EventEnvelope],
) -> None:
    async with session_maker() as s, s.begin():
        svc = ArtifactService(SqlArtifactRepo(s), tmp_path, bus=bus)
        art = await svc.create(
            name="proposal",
            kind=ArtifactKind.MARKDOWN,
            content="# draft",
            conversation_id="conv-42",
        )

    await _wait_for(lambda: len(received) >= 1)
    assert len(received) == 1
    env = received[0]
    assert env.kind == "artifact_changed"
    assert env.payload["artifact_id"] == art.id
    assert env.payload["op"] == "created"
    assert env.payload["version"] == 1
    assert env.payload["workspace_id"] == art.workspace_id
    assert env.payload["conversation_id"] == "conv-42"
    assert env.payload["artifact_kind"] == "markdown"


async def test_update_publishes_artifact_changed(
    session_maker: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    bus: EventBus,
    received: list[EventEnvelope],
) -> None:
    async with session_maker() as s, s.begin():
        svc = ArtifactService(SqlArtifactRepo(s), tmp_path, bus=bus)
        art = await svc.create(name="n", kind=ArtifactKind.MARKDOWN, content="v1")
        await svc.update(art.id, mode="overwrite", content="v2")

    await _wait_for(lambda: len(received) >= 2)
    ops = [e.payload["op"] for e in received]
    assert ops == ["created", "updated"]
    assert received[-1].payload["version"] == 2


async def test_delete_publishes_artifact_changed(
    session_maker: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    bus: EventBus,
    received: list[EventEnvelope],
) -> None:
    async with session_maker() as s, s.begin():
        svc = ArtifactService(SqlArtifactRepo(s), tmp_path, bus=bus)
        art = await svc.create(name="doomed", kind=ArtifactKind.MARKDOWN, content="x")
        await svc.delete(art.id)

    await _wait_for(lambda: len(received) >= 2)
    assert [e.payload["op"] for e in received] == ["created", "deleted"]


async def test_pin_publishes_artifact_changed(
    session_maker: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    bus: EventBus,
    received: list[EventEnvelope],
) -> None:
    async with session_maker() as s, s.begin():
        svc = ArtifactService(SqlArtifactRepo(s), tmp_path, bus=bus)
        art = await svc.create(name="keep", kind=ArtifactKind.MARKDOWN, content="x")
        await svc.set_pinned(art.id, True)
        # Idempotent re-pin should not re-publish.
        await svc.set_pinned(art.id, True)

    await _wait_for(lambda: len(received) >= 2)
    assert [e.payload["op"] for e in received] == ["created", "pinned"]


async def test_no_bus_is_silent(
    session_maker: async_sessionmaker[AsyncSession],
    tmp_path: Path,
) -> None:
    """Services built without a bus must still write artifacts — the publish
    path is opt-in so unit tests / one-off scripts don't need to wire the bus.
    """
    async with session_maker() as s, s.begin():
        svc = ArtifactService(SqlArtifactRepo(s), tmp_path)  # no bus
        art = await svc.create(name="quiet", kind=ArtifactKind.MARKDOWN, content="ok")
        assert art.version == 1


# ---------------------------------------------------------------------------
# Layer 2 — SSE endpoint forwards artifact_changed envelopes
# ---------------------------------------------------------------------------


async def test_stream_forwards_bus_event_as_sse_frame(
    session_maker: async_sessionmaker[AsyncSession],
    tmp_path: Path,
) -> None:
    """Drive the router's event_stream coroutine directly (TestClient + SSE
    deadlocks on aiosqlite; see cockpit test). The route's logic is what we
    need to validate: subscribe → filter → frame.
    """
    from fastapi import FastAPI

    from allhands.api.routers.artifacts import stream_artifacts

    # Build a minimal ASGI scope + Request whose is_disconnected returns False
    # until we flip a flag. The router only touches `request.app.state` and
    # `request.is_disconnected()`, so we stub both.
    class _App:
        def __init__(self) -> None:
            self.state = FastAPI().state

    class _FakeRequest:
        def __init__(self, app: _App) -> None:
            self.app = app
            self._closed = False

        def close(self) -> None:
            self._closed = True

        async def is_disconnected(self) -> bool:
            return self._closed

    bus = EventBus()
    app = _App()

    class _Runtime:
        pass

    runtime = _Runtime()
    runtime.bus = bus  # type: ignore[attr-defined]
    app.state.trigger_runtime = runtime

    request = _FakeRequest(app)

    # Invoke the route handler the same way FastAPI would.
    response = await stream_artifacts(request)  # type: ignore[arg-type]
    body_iter = response.body_iterator

    async def _next_non_heartbeat() -> str:
        while True:
            chunk = await asyncio.wait_for(body_iter.__anext__(), timeout=1.0)
            if isinstance(chunk, bytes):
                chunk = chunk.decode("utf-8")
            if "heartbeat" in chunk and "artifact_changed" not in chunk and "ready" not in chunk:
                continue
            return chunk

    # 1. First non-heartbeat frame is the `ready` opener.
    ready = await _next_non_heartbeat()
    assert ready.startswith("event: ready\n")

    # 2. Drive a real write, then pull the next non-heartbeat frame and assert
    #    it carries the artifact_changed envelope for the new id.
    async with session_maker() as s, s.begin():
        svc = ArtifactService(SqlArtifactRepo(s), tmp_path, bus=bus)
        art = await svc.create(name="stream-me", kind=ArtifactKind.MARKDOWN, content="hi")

    frame = await _next_non_heartbeat()
    assert frame.startswith("event: artifact_changed\n")
    assert art.id in frame
    assert '"op": "created"' in frame

    request.close()
    with contextlib.suppress(StopAsyncIteration, TimeoutError):
        await asyncio.wait_for(body_iter.__anext__(), timeout=0.2)
