"""Event → TriggerFire bridge — spec § 5.2.

Subscribes to the EventBus with a wildcard pattern (matching every event
kind we publish). On each event, scans enabled event-kind triggers and
calls `fire_callback(trigger, EVENT, payload)` for the ones whose
EventPattern matches.

We subscribe once per listener instance. A single-pattern wildcard beats
a per-trigger subscription because it lets us re-evaluate trigger state
on every event (enabled/disabled/added triggers take effect immediately,
no re-subscribe needed).
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from allhands.core import EventEnvelope, Trigger, TriggerFire, TriggerFireSource, TriggerKind
from allhands.execution.event_bus import EventBus, matches_event_pattern

FireCallback = Callable[[Trigger, TriggerFireSource, dict[str, object]], Awaitable[TriggerFire]]
ListTriggersCallback = Callable[[], Awaitable[list[Trigger]]]

logger = logging.getLogger(__name__)


class EventListener:
    def __init__(
        self,
        bus: EventBus,
        list_triggers_callback: ListTriggersCallback,
        fire_callback: FireCallback,
    ) -> None:
        self._bus = bus
        self._list = list_triggers_callback
        self._fire = fire_callback
        self._unsubscribe: Callable[[], None] | None = None

    def start(self) -> None:
        if self._unsubscribe is not None:
            return
        # Subscribe to every event; per-trigger matching happens inside
        # the handler against the live repo snapshot so CRUD takes effect
        # without re-subscription.
        self._unsubscribe = self._bus.subscribe_all(self._on_event)

    def stop(self) -> None:
        if self._unsubscribe is not None:
            self._unsubscribe()
            self._unsubscribe = None

    async def _on_event(self, env: EventEnvelope) -> None:
        try:
            triggers = await self._list()
        except Exception:
            logger.exception("event.listener.list_failed")
            return
        for t in triggers:
            if t.kind is not TriggerKind.EVENT or not t.enabled or t.event is None:
                continue
            # EventBus pattern `type="*"` does not match real kinds by equality,
            # so we do per-trigger matching ourselves.
            if not matches_event_pattern(t.event, env):
                continue
            try:
                await self._fire(t, TriggerFireSource.EVENT, dict(env.payload))
            except Exception:
                logger.exception(
                    "event.fire.failed",
                    extra={"trigger_id": t.id, "event_kind": env.kind},
                )


__all__ = ["EventListener"]
