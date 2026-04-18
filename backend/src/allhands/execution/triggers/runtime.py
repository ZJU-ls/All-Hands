"""Trigger runtime — the process-long bundle the FastAPI lifespan owns.

One instance per backend process. Ties together:
  - EventBus singleton
  - ToolRegistry singleton (reused from deps.get_tool_registry)
  - Default action handler map (notify/invoke_tool real, dispatch/continue
    are stubs until Wave C wires run_service)
  - TimerScheduler (APScheduler)
  - EventListener (EventBus subscriber)
  - Session factory so each fire gets its own DB session

The runtime does NOT hold DB sessions directly. Every fire opens its own
session through `session_factory`, builds a TriggerExecutor for that scope,
runs `fire()`, and commits. That way the executor stays test-friendly and
does not leak sessions across fires.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from allhands.execution.event_bus import EventBus
from allhands.execution.triggers.event_listener import EventListener
from allhands.execution.triggers.executor import TriggerExecutor
from allhands.execution.triggers.handlers import build_default_handlers
from allhands.execution.triggers.timer_scheduler import TimerScheduler
from allhands.persistence.sql_repos import (
    SqlEventRepo,
    SqlTriggerFireRepo,
    SqlTriggerRepo,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from allhands.core import Trigger, TriggerActionType, TriggerFire, TriggerFireSource
    from allhands.execution.registry import ToolRegistry
    from allhands.execution.triggers.executor import ActionHandler

logger = logging.getLogger(__name__)


class TriggerRuntime:
    """Process-scope owner of the trigger machinery."""

    def __init__(
        self,
        session_maker: async_sessionmaker[AsyncSession],
        tool_registry: ToolRegistry,
        *,
        paused_getter: Callable[[], bool] | None = None,
        max_fires_per_minute: int = 60,
    ) -> None:
        self._maker = session_maker
        self._tools = tool_registry
        self._paused = paused_getter or (lambda: False)
        self._max_per_minute = max_fires_per_minute

        self.bus = EventBus(persist=self._persist_envelope)
        self._handlers = build_default_handlers(self.bus, tool_registry)
        self._timer = TimerScheduler(
            fire_callback=self._fire,
            fetch_callback=self._fetch_trigger,
        )
        self._listener = EventListener(
            bus=self.bus,
            list_triggers_callback=self._list_triggers,
            fire_callback=self._fire_event,
        )
        self._started = False

    @property
    def handlers(self) -> dict[TriggerActionType, ActionHandler]:
        return dict(self._handlers)

    async def start(self) -> None:
        if self._started:
            return
        await self._timer.start()
        triggers = await self._list_triggers()
        await self._timer.reload(triggers)
        self._listener.start()
        self._started = True
        logger.info("trigger.runtime.started", extra={"triggers": len(triggers)})

    async def shutdown(self) -> None:
        if not self._started:
            return
        self._listener.stop()
        await self._timer.shutdown()
        self._started = False

    async def reload(self) -> None:
        """Called after trigger CRUD so timer jobs track persistence."""
        triggers = await self._list_triggers()
        await self._timer.reload(triggers)

    # -- fire helpers ---------------------------------------------------

    async def _fire(self, trigger: Trigger, source: TriggerFireSource) -> TriggerFire:
        async with self._session() as session:
            executor = self._build_executor(session)
            return await executor.fire(trigger, source)

    async def _fire_event(
        self,
        trigger: Trigger,
        source: TriggerFireSource,
        payload: dict[str, object],
    ) -> TriggerFire:
        async with self._session() as session:
            executor = self._build_executor(session)
            return await executor.fire(trigger, source, event_payload=payload)

    def _build_executor(self, session: AsyncSession) -> TriggerExecutor:
        return TriggerExecutor(
            trigger_repo=SqlTriggerRepo(session),
            fire_repo=SqlTriggerFireRepo(session),
            action_handlers=self._handlers,
            max_fires_per_minute=self._max_per_minute,
            paused_getter=self._paused,
        )

    # -- persistence helpers -------------------------------------------

    @asynccontextmanager
    async def _session(self) -> AsyncIterator[AsyncSession]:
        async with self._maker() as session, session.begin():
            yield session

    async def _fetch_trigger(self, trigger_id: str) -> Trigger | None:
        async with self._session() as session:
            return await SqlTriggerRepo(session).get(trigger_id)

    async def _list_triggers(self) -> list[Trigger]:
        async with self._session() as session:
            return await SqlTriggerRepo(session).list_all()

    async def _persist_envelope(self, env: object) -> None:
        from allhands.core import EventEnvelope

        if not isinstance(env, EventEnvelope):
            return
        async with self._session() as session:
            await SqlEventRepo(session).save(env)


# -- helpers for publishing from request scope --------------------------


async def publish_webhook(
    runtime: TriggerRuntime,
    trigger_id: str,
    body: dict[str, object],
) -> None:
    """Webhook endpoint helper. Publishes a `webhook.external` event with
    the trigger_id as a payload field so EventPattern filters can narrow
    by {"trigger_id": "..."} the same way other events are filtered.
    """
    await runtime.bus.publish(
        kind="webhook.external",
        payload={"trigger_id": trigger_id, "body": body},
    )


__all__ = ["TriggerRuntime", "publish_webhook"]
