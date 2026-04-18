"""TriggerService — CRUD + manual fire.

Thin layer over the Trigger/TriggerFire repos. REST router + Meta tools both
talk to this class (Tool First L01: one service, two entry points). fire_now()
builds a per-call TriggerExecutor with the injected handler map — scheduler
+ event listener wiring live in a later module and reuse the same service.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from allhands.core import (
    EventPattern,
    TimerSpec,
    Trigger,
    TriggerAction,
    TriggerActionType,
    TriggerFire,
    TriggerFireSource,
    TriggerKind,
)
from allhands.execution.triggers.executor import TriggerExecutor

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from allhands.execution.triggers.executor import ActionHandler
    from allhands.persistence.repositories import (
        TriggerFireRepo,
        TriggerRepo,
    )


class TriggerNotFoundError(Exception):
    def __init__(self, trigger_id: str) -> None:
        super().__init__(f"Trigger not found: {trigger_id}")
        self.trigger_id = trigger_id


class TriggerService:
    def __init__(
        self,
        trigger_repo: TriggerRepo,
        fire_repo: TriggerFireRepo,
        action_handlers: dict[TriggerActionType, ActionHandler] | None = None,
        *,
        paused_getter: Callable[[], bool] | None = None,
        max_fires_per_minute: int = 60,
        ancestor_chain_getter: Callable[[str | None], Awaitable[frozenset[str]]] | None = None,
    ) -> None:
        self._triggers = trigger_repo
        self._fires = fire_repo
        self._handlers = action_handlers or {}
        self._paused = paused_getter
        self._max_per_minute = max_fires_per_minute
        self._ancestors = ancestor_chain_getter

    # -- queries --------------------------------------------------------

    async def list_all(self) -> list[Trigger]:
        return await self._triggers.list_all()

    async def get(self, trigger_id: str) -> Trigger:
        t = await self._triggers.get(trigger_id)
        if t is None:
            raise TriggerNotFoundError(trigger_id)
        return t

    async def list_fires(self, trigger_id: str, limit: int = 50) -> list[TriggerFire]:
        return await self._fires.list_for_trigger(trigger_id, limit=limit)

    # -- mutations ------------------------------------------------------

    async def create(
        self,
        *,
        name: str,
        kind: TriggerKind,
        action: TriggerAction,
        timer: TimerSpec | None = None,
        event: EventPattern | None = None,
        min_interval_seconds: int = 300,
        created_by: str = "user",
        enabled: bool = True,
    ) -> Trigger:
        trigger = Trigger(
            id=f"trg_{uuid.uuid4().hex[:16]}",
            name=name,
            kind=kind,
            timer=timer,
            event=event,
            action=action,
            min_interval_seconds=min_interval_seconds,
            enabled=enabled,
            created_at=datetime.now(UTC),
            created_by=created_by,
        )
        return await self._triggers.upsert(trigger)

    async def update(
        self,
        trigger_id: str,
        *,
        name: str | None = None,
        action: TriggerAction | None = None,
        timer: TimerSpec | None = None,
        event: EventPattern | None = None,
        min_interval_seconds: int | None = None,
    ) -> Trigger:
        current = await self.get(trigger_id)
        update: dict[str, Any] = {}
        if name is not None:
            update["name"] = name
        if action is not None:
            update["action"] = action
        if timer is not None:
            update["timer"] = timer
        if event is not None:
            update["event"] = event
        if min_interval_seconds is not None:
            update["min_interval_seconds"] = min_interval_seconds
        if not update:
            return current
        updated = current.model_copy(update=update)
        return await self._triggers.upsert(updated)

    async def toggle(self, trigger_id: str, enabled: bool) -> Trigger:
        current = await self.get(trigger_id)
        update: dict[str, Any] = {"enabled": enabled}
        if enabled:
            # manual re-enable clears the auto-disable streak + reason (spec § 7.2)
            update["fires_failed_streak"] = 0
            update["auto_disabled_reason"] = None
        return await self._triggers.upsert(current.model_copy(update=update))

    async def delete(self, trigger_id: str) -> None:
        # Access to raise TriggerNotFoundError for missing ids (keeps REST 404 honest)
        await self.get(trigger_id)
        await self._triggers.delete(trigger_id)

    async def fire_now(
        self,
        trigger_id: str,
        event_payload: dict[str, Any] | None = None,
    ) -> TriggerFire:
        trigger = await self.get(trigger_id)
        executor = self._build_executor()
        return await executor.fire(
            trigger,
            source=TriggerFireSource.MANUAL,
            event_payload=event_payload,
        )

    def _build_executor(self) -> TriggerExecutor:
        return TriggerExecutor(
            trigger_repo=self._triggers,
            fire_repo=self._fires,
            action_handlers=self._handlers,
            max_fires_per_minute=self._max_per_minute,
            paused_getter=self._paused,
            ancestor_chain_getter=self._ancestors,
        )
