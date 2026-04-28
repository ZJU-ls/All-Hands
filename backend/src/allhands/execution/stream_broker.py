"""Per-run stream broker · keeps the agent task alive across SSE drops.

Pre-2026-04-28 the chat SSE was driven directly by the `send_message`
async generator: the FastAPI response handler awaited the iterator and
piped each event onto the wire. When the client disconnected (browser tab
switch, route change, network blip), the response was cancelled, which
cancelled the upstream iterator, which cancelled the agent's LLM/tool
work mid-flight. Users routinely lost mid-stream tokens, half-issued tool
calls, and abandoned spawn_subagent runs just because they clicked
elsewhere.

This module decouples the two:

  - A `RunBroker` owns the agent task. It pulls events from
    `send_message`, persists them to a bounded buffer, and fans them out
    to any number of subscribers.
  - The first SSE response (POST /messages) is one subscriber.
  - Reconnects (POST /runs/{run_id}/subscribe) get a fresh subscriber
    that's first replayed the buffer, then attached to the live tail.

The buffer is bounded so a long-running agent can't OOM the process if
nobody ever reconnects. The broker self-destructs after `idle_grace_s`
of having zero subscribers post-completion, freeing the buffer.

v0 lives entirely in memory · uvicorn reload + multi-worker deployments
explicitly out of scope (single-worker dev/prod-MVP cover 99% of users).
A Redis pubsub backend is the obvious follow-up if/when we scale out;
the broker interface is small enough to swap.
"""

from __future__ import annotations

import asyncio
import contextlib
import inspect
import logging
import time
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger(__name__)


# Bounded so a runaway / unattended run doesn't OOM the box. ~5k events =
# many hundreds of LLM token chunks plus tool calls — a typical Lead turn
# is well under 500. Reconnects beyond the cap miss the head of the buffer
# but still get the live tail; we log a warning when this happens.
DEFAULT_BUFFER_LIMIT = 5000

# After RUN_FINISHED / RUN_ERROR we keep the broker alive briefly so a
# slow client can still reconnect and replay the final tokens. Shorter
# than the 5min Anthropic prompt-cache window — drift past this and the
# next turn would have to re-send full history anyway.
DEFAULT_IDLE_GRACE_S = 60.0


@dataclass
class RunBroker:
    """Owns the agent task for one (conversation_id, run_id) pair.

    Subscribers each get an `asyncio.Queue` that receives every buffered
    event followed by every subsequent live event. End-of-stream is
    signalled by enqueueing `None`.
    """

    conversation_id: str
    run_id: str
    buffer: deque[Any] = field(default_factory=lambda: deque(maxlen=DEFAULT_BUFFER_LIMIT))
    subscribers: set[asyncio.Queue[Any]] = field(default_factory=set)
    ended: bool = False
    end_reason: str | None = None  # "finished" | "error" | "cancelled"
    started_at: float = field(default_factory=time.monotonic)
    ended_at: float | None = None
    _task: asyncio.Task[None] | None = None
    _gc_task: asyncio.Task[None] | None = None
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def append(self, event: Any) -> None:
        """Buffer an event and fan it out to every active subscriber.

        Called from the broker's runner coroutine. Subscribers that have
        fallen behind (full queue) drop the oldest pending event rather
        than block the producer · we'd rather a flaky consumer miss a
        chunk than stall the agent for everyone.
        """
        self.buffer.append(event)
        for q in list(self.subscribers):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                # Drop one to make room, then put. Rare in practice — the
                # SSE sink is much faster than LLM token gen.
                with contextlib.suppress(asyncio.QueueEmpty):
                    q.get_nowait()
                try:
                    q.put_nowait(event)
                except asyncio.QueueFull:
                    log.warning(
                        "stream_broker.subscriber_drop",
                        extra={"run_id": self.run_id},
                    )

    async def subscribe(self) -> asyncio.Queue[Any]:
        """Attach a new consumer · returns a queue pre-loaded with the
        buffered backlog so reconnects don't see a gap."""
        # Generous queue size so even a slow client doesn't trigger drops
        # mid-token-burst.
        q: asyncio.Queue[Any] = asyncio.Queue(maxsize=2 * DEFAULT_BUFFER_LIMIT)
        async with self._lock:
            for ev in self.buffer:
                try:
                    q.put_nowait(ev)
                except asyncio.QueueFull:
                    break
            if self.ended:
                # Signal end-of-stream so the SSE encoder closes cleanly
                # even after RUN_FINISHED has already been buffered.
                q.put_nowait(None)
                return q
            self.subscribers.add(q)
        return q

    async def unsubscribe(self, q: asyncio.Queue[Any]) -> None:
        """Detach a consumer (client disconnect). The broker keeps
        running — that's the whole point."""
        async with self._lock:
            self.subscribers.discard(q)

    def _signal_end_to_subscribers(self) -> None:
        for q in list(self.subscribers):
            try:
                q.put_nowait(None)
            except asyncio.QueueFull:
                # Same drop strategy.
                with contextlib.suppress(asyncio.QueueEmpty):
                    q.get_nowait()
                with contextlib.suppress(asyncio.QueueFull):
                    q.put_nowait(None)


class BrokerRegistry:
    """Process-wide registry. One singleton per FastAPI app.

    The agent's send_message generator runs inside a background task per
    run; the registry holds references so subsequent HTTP requests can
    look the broker up by run_id (resume) or list active runs by
    conversation (auto-resubscribe on chat page mount).
    """

    def __init__(
        self,
        *,
        idle_grace_s: float = DEFAULT_IDLE_GRACE_S,
        buffer_limit: int = DEFAULT_BUFFER_LIMIT,
    ) -> None:
        self._idle_grace_s = idle_grace_s
        self._buffer_limit = buffer_limit
        self._brokers: dict[str, RunBroker] = {}  # by run_id
        self._by_conv: dict[str, str] = {}  # conv_id -> run_id (active only)
        self._lock = asyncio.Lock()

    async def start_run(
        self,
        conversation_id: str,
        run_id: str,
        producer: Callable[[], Awaitable[AsyncIterator[Any]] | AsyncIterator[Any]],
    ) -> RunBroker:
        """Create a broker, spawn the agent task, return the broker.

        ``producer`` is a no-arg async callable that opens the agent
        event iterator (e.g. ``lambda: chat_service.send_message(...)``).
        We pull from it and append to the broker buffer in a background
        task so HTTP response handlers can detach without killing it.
        """
        broker = RunBroker(
            conversation_id=conversation_id,
            run_id=run_id,
            buffer=deque(maxlen=self._buffer_limit),
        )
        async with self._lock:
            self._brokers[run_id] = broker
            # Replace any previous active run for the same conv. Two
            # active runs on one conversation should be impossible at
            # the chat-service layer (turn lock), but if it happens we
            # prefer the newer one.
            self._by_conv[conversation_id] = run_id
        broker._task = asyncio.create_task(
            self._run(broker, producer),
            name=f"run-broker:{run_id}",
        )
        return broker

    async def _run(
        self,
        broker: RunBroker,
        producer: Callable[[], Awaitable[AsyncIterator[Any]] | AsyncIterator[Any]],
    ) -> None:
        try:
            # `producer` may either *return* an async iterator (a function
            # that itself contains `yield`) or return a coroutine that
            # resolves to one (the typical chat_service.send_message path).
            # Accept both shapes to keep callers ergonomic.
            stream_or_coro = producer()
            if inspect.iscoroutine(stream_or_coro):
                stream = await stream_or_coro
            else:
                stream = stream_or_coro
            async for event in stream:
                broker.append(event)
        except asyncio.CancelledError:
            broker.end_reason = "cancelled"
            raise
        except Exception:
            broker.end_reason = "error"
            log.exception(
                "stream_broker.producer_failed",
                extra={"run_id": broker.run_id},
            )
            # Push a synthetic error sentinel so reconnecting clients
            # learn the run died · matches the AG-UI RUN_ERROR shape.
            broker.append({"__broker_error__": True})
        else:
            broker.end_reason = "finished"
        finally:
            broker.ended = True
            broker.ended_at = time.monotonic()
            broker._signal_end_to_subscribers()
            # Schedule GC after the grace window. We do NOT await — a
            # blocking GC would couple producer lifetime to the cleanup
            # delay. Sleeping inside the task is fine because the task is
            # done and we're just counting down.
            broker._gc_task = asyncio.create_task(
                self._schedule_gc(broker),
                name=f"run-broker-gc:{broker.run_id}",
            )

    async def _schedule_gc(self, broker: RunBroker) -> None:
        try:
            await asyncio.sleep(self._idle_grace_s)
        except asyncio.CancelledError:
            return
        async with self._lock:
            self._brokers.pop(broker.run_id, None)
            # Only clear the conv pointer if it still points at this run.
            if self._by_conv.get(broker.conversation_id) == broker.run_id:
                self._by_conv.pop(broker.conversation_id, None)

    def get(self, run_id: str) -> RunBroker | None:
        return self._brokers.get(run_id)

    def active_run_for_conversation(self, conversation_id: str) -> str | None:
        """Return the run_id of the currently-active run for this conv,
        or None if no run is open. "Active" means the agent task hasn't
        ended yet · finished runs disappear from the conv pointer once
        their grace window closes (still resolvable by run_id directly
        for late reconnects)."""
        run_id = self._by_conv.get(conversation_id)
        if run_id is None:
            return None
        broker = self._brokers.get(run_id)
        if broker is None or broker.ended:
            return None
        return run_id


_REGISTRY: BrokerRegistry | None = None


def get_broker_registry() -> BrokerRegistry:
    """Lazy module-level singleton. FastAPI deps + tests both go through
    this so they share the same registry within a process."""
    global _REGISTRY
    if _REGISTRY is None:
        _REGISTRY = BrokerRegistry()
    return _REGISTRY


def reset_broker_registry_for_tests() -> None:
    """Tests that want a fresh registry between cases can reset here.
    Production callers should never need this."""
    global _REGISTRY
    _REGISTRY = None
