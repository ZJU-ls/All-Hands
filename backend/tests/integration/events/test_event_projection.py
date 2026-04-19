"""Event projection smoke (I-0011 · cockpit § 11 · triggers § 4).

The EventBus is the single pub/sub between producers (ArtifactService,
AgentRunner, Gate, MCPClient, ...) and consumers (cockpit SSE, trigger
executor, observatory). This file pins the two things that must always hold:

  1. **Round-trip:** ``publish(kind, payload)`` reaches subscribers whose
     ``EventPattern`` matches, with a persist callback invoked exactly once.
  2. **SSE projection:** ``cockpit.stream`` maps the event kind to the right
     SSE event name (``run.started`` → ``run_update`` / ``run.finished`` →
     ``run_done`` / unknown → generic ``activity``). Drift in that map would
     let run cards fail to update silently in the cockpit.

The full stream path (EventSource-level) is xfailed — ``test_cockpit_api.py``
already documents why the TestClient + aiosqlite combo deadlocks on chunked
responses, so the workspace SSE round-trip is tested via the private
``event_stream`` coroutine instead (see ``test_artifacts_sse.py``).

spec: ``docs/specs/agent-design/2026-04-18-cockpit.md § 7`` + § 11
spec: ``docs/specs/agent-design/2026-04-18-triggers.md § 4``
issue: ``docs/issues/closed/I-0011-missing-integration-e2e-tests.md``
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable

import pytest

from allhands.api.routers.cockpit import _KIND_TO_CUSTOM_NAME
from allhands.core import EventEnvelope, EventPattern
from allhands.execution.event_bus import EventBus


async def _wait_for(predicate: Callable[[], bool], deadline_s: float = 1.0) -> None:
    cutoff = asyncio.get_event_loop().time() + deadline_s
    while not predicate():
        if asyncio.get_event_loop().time() > cutoff:
            raise AssertionError("timed out waiting for bus handler")
        await asyncio.sleep(0.01)


async def test_publish_persists_once_and_fans_out_to_matching_subscriber() -> None:
    persisted: list[EventEnvelope] = []

    async def persist(env: EventEnvelope) -> None:
        persisted.append(env)

    bus = EventBus(persist=persist)

    runs: list[EventEnvelope] = []

    async def on_run(env: EventEnvelope) -> None:
        runs.append(env)

    bus.subscribe(EventPattern(type="run.started"), on_run)

    env = await bus.publish("run.started", payload={"run_id": "r-1", "depth": 0})
    await _wait_for(lambda: len(runs) == 1)

    assert persisted == [env]
    assert runs == [env]
    assert runs[0].payload["run_id"] == "r-1"


async def test_subscriber_filter_ignores_mismatched_kind() -> None:
    bus = EventBus()
    runs: list[EventEnvelope] = []

    async def on_run(env: EventEnvelope) -> None:
        runs.append(env)

    bus.subscribe(EventPattern(type="run.started"), on_run)
    await bus.publish("artifact.created", payload={"id": "a-1"})
    # Give fan-out a chance — we expect the handler not to be called at all.
    await asyncio.sleep(0.05)
    assert runs == []


async def test_subscribe_all_receives_every_kind() -> None:
    bus = EventBus()
    sink: list[str] = []

    async def on_any(env: EventEnvelope) -> None:
        sink.append(env.kind)

    unsubscribe = bus.subscribe_all(on_any)
    await bus.publish("run.started", payload={"run_id": "r-1"})
    await bus.publish("artifact.updated", payload={"id": "a-1"})
    await _wait_for(lambda: len(sink) == 2)
    unsubscribe()
    await bus.publish("run.finished", payload={"run_id": "r-1"})
    await asyncio.sleep(0.05)
    assert sink == ["run.started", "artifact.updated"]


def test_cockpit_kind_to_custom_name_map_covers_spec_frames() -> None:
    """cockpit spec § 4.2 declares run_update / run_done / health / kpi.

    Under AG-UI v1 (ADR 0010) each legacy SSE event name becomes a CUSTOM
    envelope with ``name`` ``allhands.cockpit_<suffix>``. The router keeps a
    lookup table (unknown kinds fall through to ``allhands.cockpit_activity``).
    If a producer renames a kind without updating the map the CUSTOM name
    regresses to activity and the cockpit stops moving run cards — this test
    is the trip wire.
    """
    assert _KIND_TO_CUSTOM_NAME["run.started"] == "allhands.cockpit_run_update"
    assert _KIND_TO_CUSTOM_NAME["run.finished"] == "allhands.cockpit_run_done"
    assert _KIND_TO_CUSTOM_NAME["run.cancelled"] == "allhands.cockpit_run_done"
    assert _KIND_TO_CUSTOM_NAME["health.updated"] == "allhands.cockpit_health"
    assert _KIND_TO_CUSTOM_NAME["kpi.updated"] == "allhands.cockpit_kpi"


@pytest.mark.xfail(
    reason=(
        "cockpit § 11 bullet 'stream first frame is snapshot' — full EventSource "
        "round-trip through /api/cockpit/stream hits the TestClient + aiosqlite "
        "chunked-response deadlock (see test_cockpit_api.py). Tracked separately; "
        "contract is pinned via _KIND_TO_SSE_EVENT + test_artifacts_sse.py."
    ),
    strict=True,
)
async def test_cockpit_stream_emits_snapshot_then_projected_events() -> None:
    raise NotImplementedError(
        "needs the shared StreamingResponse harness from test_cockpit_api.py "
        "once the TestClient deadlock is resolved"
    )
