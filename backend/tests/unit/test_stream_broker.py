"""Tests for the per-run stream broker (stream_broker.py).

Covers the contract that 2026-04-28 introduced:
  - SSE consumer disconnect ≠ agent task cancellation
  - reconnect replays the full buffer + attaches to live tail
  - finished runs survive the idle-grace window for late reconnects
  - lookup by conv_id surfaces the active run for auto-resubscribe
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import pytest

from allhands.execution.stream_broker import (
    BrokerRegistry,
    reset_broker_registry_for_tests,
)


@pytest.fixture(autouse=True)
def _reset_registry():
    reset_broker_registry_for_tests()
    yield
    reset_broker_registry_for_tests()


async def _drain_until_end(q: asyncio.Queue[object], max_events: int = 1000) -> list[object]:
    out: list[object] = []
    for _ in range(max_events):
        ev = await asyncio.wait_for(q.get(), timeout=2.0)
        if ev is None:
            break
        out.append(ev)
    return out


async def test_first_subscriber_sees_every_event() -> None:
    reg = BrokerRegistry()

    async def producer() -> AsyncIterator[dict]:
        for i in range(5):
            yield {"i": i}

    broker = await reg.start_run("conv-1", "run-1", lambda: producer())
    q = await broker.subscribe()
    events = await _drain_until_end(q)
    assert [e["i"] for e in events] == [0, 1, 2, 3, 4]
    assert broker.ended is True
    assert broker.end_reason == "finished"


async def test_disconnect_does_not_cancel_the_run() -> None:
    """The whole point: HTTP client drops, agent keeps running."""
    reg = BrokerRegistry()
    started = asyncio.Event()
    keep_going = asyncio.Event()

    async def producer() -> AsyncIterator[dict]:
        yield {"phase": "early"}
        started.set()
        # Block until we explicitly release · simulates the LLM still
        # working away.
        await keep_going.wait()
        yield {"phase": "late"}

    broker = await reg.start_run("conv-2", "run-2", lambda: producer())
    q1 = await broker.subscribe()
    # First event lands on the wire.
    first = await asyncio.wait_for(q1.get(), timeout=2.0)
    assert first == {"phase": "early"}
    await started.wait()

    # Client disconnects.
    await broker.unsubscribe(q1)
    assert broker.ended is False  # task is still alive
    assert len(broker.subscribers) == 0

    # Reconnect a moment later — should still work.
    q2 = await broker.subscribe()
    keep_going.set()
    events = await _drain_until_end(q2)
    phases = [e["phase"] for e in events]
    # The late event arrives via the live tail; the early one was already
    # in the buffer at subscribe time.
    assert "early" in phases
    assert "late" in phases


async def test_reconnect_replays_buffer_in_order() -> None:
    reg = BrokerRegistry()
    pace = asyncio.Event()

    async def producer() -> AsyncIterator[dict]:
        yield {"i": 0}
        yield {"i": 1}
        yield {"i": 2}
        await pace.wait()
        yield {"i": 3}

    broker = await reg.start_run("conv-3", "run-3", lambda: producer())
    # Wait until the producer has emitted three events.
    while len(broker.buffer) < 3:  # noqa: ASYNC110
        await asyncio.sleep(0.005)

    # Now subscribe (simulating a "I tabbed in late" client).
    q = await broker.subscribe()
    pace.set()
    events = await _drain_until_end(q)
    assert [e["i"] for e in events] == [0, 1, 2, 3]


async def test_active_run_for_conversation_surfaces_only_live() -> None:
    reg = BrokerRegistry(idle_grace_s=10.0)
    done = asyncio.Event()

    async def producer() -> AsyncIterator[dict]:
        yield {"i": 0}
        await done.wait()
        yield {"i": 1}

    broker = await reg.start_run("conv-4", "run-4", lambda: producer())
    assert reg.active_run_for_conversation("conv-4") == "run-4"

    # Drain a bit to confirm task is running.
    q = await broker.subscribe()
    await asyncio.wait_for(q.get(), timeout=2.0)

    done.set()
    # Wait for the run to end.
    while not broker.ended:  # noqa: ASYNC110
        await asyncio.sleep(0.005)

    assert reg.active_run_for_conversation("conv-4") is None


async def test_late_reconnect_after_finish_still_replays() -> None:
    """Within the idle grace window the broker must still serve replays
    so a slow client reconnecting after RUN_FINISHED doesn't see a
    blank chat."""
    reg = BrokerRegistry(idle_grace_s=10.0)

    async def producer() -> AsyncIterator[dict]:
        yield {"i": 0}
        yield {"i": 1}

    broker = await reg.start_run("conv-5", "run-5", lambda: producer())

    # Let the producer finish.
    while not broker.ended:  # noqa: ASYNC110
        await asyncio.sleep(0.01)

    # Late subscribe.
    q = await broker.subscribe()
    events = await _drain_until_end(q)
    assert [e["i"] for e in events] == [0, 1]


async def test_gc_after_grace_clears_broker() -> None:
    reg = BrokerRegistry(idle_grace_s=0.05)  # tiny so the test stays fast

    async def producer() -> AsyncIterator[dict]:
        yield {"i": 0}

    broker = await reg.start_run("conv-6", "run-6", lambda: producer())
    while not broker.ended:  # noqa: ASYNC110
        await asyncio.sleep(0.005)
    # Wait beyond grace.
    await asyncio.sleep(0.2)
    assert reg.get("run-6") is None
    assert reg.active_run_for_conversation("conv-6") is None


async def test_producer_error_marks_broker_with_synthetic_event() -> None:
    reg = BrokerRegistry(idle_grace_s=10.0)

    async def producer() -> AsyncIterator[dict]:
        yield {"i": 0}
        raise RuntimeError("boom")

    broker = await reg.start_run("conv-7", "run-7", lambda: producer())
    while not broker.ended:  # noqa: ASYNC110
        await asyncio.sleep(0.005)
    assert broker.end_reason == "error"
    # Last buffered event is the synthetic broker error sentinel.
    assert broker.buffer[-1] == {"__broker_error__": True}


async def test_two_subscribers_get_independent_streams() -> None:
    reg = BrokerRegistry()
    pace = asyncio.Event()

    async def producer() -> AsyncIterator[dict]:
        yield {"i": 0}
        await pace.wait()
        yield {"i": 1}

    broker = await reg.start_run("conv-8", "run-8", lambda: producer())
    q1 = await broker.subscribe()
    q2 = await broker.subscribe()

    first1 = await asyncio.wait_for(q1.get(), timeout=2.0)
    first2 = await asyncio.wait_for(q2.get(), timeout=2.0)
    assert first1 == {"i": 0}
    assert first2 == {"i": 0}

    pace.set()
    second1 = await asyncio.wait_for(q1.get(), timeout=2.0)
    second2 = await asyncio.wait_for(q2.get(), timeout=2.0)
    assert second1 == {"i": 1}
    assert second2 == {"i": 1}
