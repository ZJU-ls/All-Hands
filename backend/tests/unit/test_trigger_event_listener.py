"""Unit tests · execution/triggers/event_listener.py.

Contract (spec § 5.2):
- subscribes to the bus on start, unsubscribes on stop
- on event: re-fetches triggers from repo, fires each enabled event trigger
  whose EventPattern matches
- disabled triggers are skipped
- timer-kind triggers are never fired by the listener
- webhook payload {"trigger_id": "X"} matches only the trigger named X via
  the filter {"trigger_id": "X"} (spec § 9 webhook contract)
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import pytest

from allhands.core import (
    EventPattern,
    TimerSpec,
    Trigger,
    TriggerAction,
    TriggerActionType,
    TriggerFire,
    TriggerFireSource,
    TriggerFireStatus,
    TriggerKind,
)
from allhands.execution.event_bus import EventBus
from allhands.execution.triggers.event_listener import EventListener


def _fire_stub(trigger: Trigger) -> TriggerFire:
    return TriggerFire(
        id=f"fire_{trigger.id}",
        trigger_id=trigger.id,
        fired_at=datetime.now(UTC),
        source=TriggerFireSource.EVENT,
        action_snapshot=trigger.action,
        status=TriggerFireStatus.DISPATCHED,
    )


def _mk_trigger(
    *,
    id_: str,
    kind: TriggerKind = TriggerKind.EVENT,
    enabled: bool = True,
    event: EventPattern | None = None,
    timer: TimerSpec | None = None,
) -> Trigger:
    if kind is TriggerKind.EVENT and event is None:
        event = EventPattern(type="test.kind")
    if kind is TriggerKind.TIMER and timer is None:
        timer = TimerSpec(cron="* * * * *")
    return Trigger(
        id=id_,
        name=id_,
        kind=kind,
        enabled=enabled,
        event=event,
        timer=timer,
        action=TriggerAction(type=TriggerActionType.NOTIFY_USER, message="m"),
        created_at=datetime.now(UTC),
        created_by="test",
    )


async def _flush() -> None:
    # event bus fan-out is asyncio.create_task; yield a few ticks
    for _ in range(3):
        await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_fires_matching_event_trigger() -> None:
    bus = EventBus()
    t = _mk_trigger(id_="trg_x", event=EventPattern(type="run.started"))
    fires: list[str] = []

    async def list_triggers() -> list[Trigger]:
        return [t]

    async def fire_cb(
        trigger: Trigger, source: TriggerFireSource, payload: dict[str, object]
    ) -> TriggerFire:
        fires.append(trigger.id)
        return _fire_stub(trigger)

    listener = EventListener(bus, list_triggers, fire_cb)
    listener.start()
    await bus.publish("run.started", {"run_id": "r1"})
    await _flush()
    assert fires == ["trg_x"]


@pytest.mark.asyncio
async def test_skips_disabled_and_timer_triggers() -> None:
    bus = EventBus()
    t_disabled = _mk_trigger(id_="d", enabled=False)
    t_timer = _mk_trigger(id_="t", kind=TriggerKind.TIMER)
    fires: list[str] = []

    async def list_triggers() -> list[Trigger]:
        return [t_disabled, t_timer]

    async def fire_cb(
        trigger: Trigger, source: TriggerFireSource, payload: dict[str, object]
    ) -> TriggerFire:
        fires.append(trigger.id)
        return _fire_stub(trigger)

    listener = EventListener(bus, list_triggers, fire_cb)
    listener.start()
    await bus.publish("test.kind", {})
    await _flush()
    assert fires == []


@pytest.mark.asyncio
async def test_filter_narrows_to_matching_trigger() -> None:
    bus = EventBus()
    t1 = _mk_trigger(
        id_="trg_1",
        event=EventPattern(type="webhook.external", filter={"trigger_id": "trg_1"}),
    )
    t2 = _mk_trigger(
        id_="trg_2",
        event=EventPattern(type="webhook.external", filter={"trigger_id": "trg_2"}),
    )
    fires: list[str] = []

    async def list_triggers() -> list[Trigger]:
        return [t1, t2]

    async def fire_cb(
        trigger: Trigger, source: TriggerFireSource, payload: dict[str, object]
    ) -> TriggerFire:
        fires.append(trigger.id)
        return _fire_stub(trigger)

    listener = EventListener(bus, list_triggers, fire_cb)
    listener.start()
    await bus.publish("webhook.external", {"trigger_id": "trg_2", "body": {}})
    await _flush()
    assert fires == ["trg_2"]


@pytest.mark.asyncio
async def test_stop_unsubscribes() -> None:
    bus = EventBus()
    t = _mk_trigger(id_="trg_x")
    fires: list[str] = []

    async def list_triggers() -> list[Trigger]:
        return [t]

    async def fire_cb(
        trigger: Trigger, source: TriggerFireSource, payload: dict[str, object]
    ) -> TriggerFire:
        fires.append(trigger.id)
        return _fire_stub(trigger)

    listener = EventListener(bus, list_triggers, fire_cb)
    listener.start()
    listener.stop()
    await bus.publish("test.kind", {})
    await _flush()
    assert fires == []
