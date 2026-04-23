"""In-process EventBus — publishes EventEnvelopes to the activity feed + triggers.

See docs/specs/agent-design/2026-04-18-triggers.md § 4. One publish call does
two things:
  1. persists the envelope (via injected callback — owned by the service layer
     so session/commit lifecycle stays there)
  2. fans out to in-memory subscribers whose EventPattern matches

Subscriber dispatch is fire-and-forget (asyncio.create_task) so a slow handler
cannot stall the publisher. Handler exceptions are logged and swallowed — the
trigger executor is the defense-rule authority, not the bus.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from fnmatch import fnmatchcase
from typing import TYPE_CHECKING, Any

from allhands.core import EventEnvelope, EventPattern

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    EventHandler = Callable[[EventEnvelope], Awaitable[None]]
    PersistCallback = Callable[[EventEnvelope], Awaitable[None]]

logger = logging.getLogger(__name__)


def matches_event_pattern(pattern: EventPattern, env: EventEnvelope) -> bool:
    """Pure matcher — strict type equality + per-field filter semantics.

    Filter semantics (spec § 4.3):
      - key ending in `_pattern` → fnmatch glob against payload[key_without_suffix]
      - otherwise → payload[key] == value
    """
    if pattern.type != env.kind:
        return False
    for key, expected in pattern.filter.items():
        if key.endswith("_pattern") and isinstance(expected, str):
            field = key[: -len("_pattern")]
            actual = env.payload.get(field)
            if not isinstance(actual, str) or not fnmatchcase(actual, expected):
                return False
        else:
            if env.payload.get(key) != expected:
                return False
    return True


class EventBus:
    """Minimal async pub/sub with persistence hook.

    persist: callable invoked with the envelope before fan-out. The caller
    owns the session; the bus only awaits and does not swallow exceptions
    from it — a persist failure means the event never happened.
    """

    def __init__(self, persist: PersistCallback | None = None) -> None:
        self._persist = persist
        self._subs: list[tuple[EventPattern, EventHandler]] = []
        self._catchall: list[EventHandler] = []
        self._inflight: set[asyncio.Task[None]] = set()

    async def publish(
        self,
        kind: str,
        payload: dict[str, Any] | None = None,
        trigger_id: str | None = None,
    ) -> EventEnvelope:
        env = EventEnvelope(
            id=f"evt_{uuid.uuid4().hex[:16]}",
            kind=kind,
            payload=payload or {},
            published_at=datetime.now(UTC),
            trigger_id=trigger_id,
        )
        if self._persist is not None:
            await self._persist(env)
        for pattern, handler in list(self._subs):
            if matches_event_pattern(pattern, env):
                self._spawn(handler, env)
        for handler in list(self._catchall):
            self._spawn(handler, env)
        return env

    def publish_best_effort(
        self,
        kind: str,
        payload: dict[str, Any] | None = None,
        trigger_id: str | None = None,
    ) -> None:
        """Fire-and-forget variant for telemetry (cockpit beats, run.started /
        .completed, conversation.turn_completed).

        Used from the SSE chat critical path (E18): awaiting ``publish()``
        there meant every turn stalled ~3-5 s while the EventBus's separate
        DB session contended with the request session for the single SQLite
        write lock. The user perceived it as "button stays in streaming
        state after the model finished". For telemetry events whose loss
        doesn't break a contract, we spawn the persist + fan-out as a
        background task and return immediately; exceptions are logged by
        ``_safe_persist``. Trigger-critical publishes (webhooks, anything
        consumers treat as a record of truth) must keep using ``publish()``.
        """
        env = EventEnvelope(
            id=f"evt_{uuid.uuid4().hex[:16]}",
            kind=kind,
            payload=payload or {},
            published_at=datetime.now(UTC),
            trigger_id=trigger_id,
        )
        task = asyncio.create_task(self._persist_and_fanout(env))
        self._inflight.add(task)
        task.add_done_callback(self._inflight.discard)

    async def _persist_and_fanout(self, env: EventEnvelope) -> None:
        if self._persist is not None:
            try:
                await self._persist(env)
            except Exception:
                logger.exception(
                    "best-effort event persist failed",
                    extra={"event_id": env.id, "kind": env.kind},
                )
        for pattern, handler in list(self._subs):
            if matches_event_pattern(pattern, env):
                self._spawn(handler, env)
        for handler in list(self._catchall):
            self._spawn(handler, env)

    def _spawn(self, handler: EventHandler, env: EventEnvelope) -> None:
        task = asyncio.create_task(self._safe_invoke(handler, env))
        self._inflight.add(task)
        task.add_done_callback(self._inflight.discard)

    def subscribe(
        self,
        pattern: EventPattern,
        handler: EventHandler,
    ) -> Callable[[], None]:
        entry = (pattern, handler)
        self._subs.append(entry)

        def unsubscribe() -> None:
            if entry in self._subs:
                self._subs.remove(entry)

        return unsubscribe

    def subscribe_all(self, handler: EventHandler) -> Callable[[], None]:
        """Fire on every event regardless of kind. Used by the trigger event
        listener, which does its own per-trigger matching against a live repo
        snapshot so that CRUD takes effect without re-subscription.
        """
        self._catchall.append(handler)

        def unsubscribe() -> None:
            if handler in self._catchall:
                self._catchall.remove(handler)

        return unsubscribe

    @staticmethod
    async def _safe_invoke(handler: EventHandler, env: EventEnvelope) -> None:
        try:
            await handler(env)
        except Exception:
            logger.exception("event handler raised; swallowed to protect bus")
