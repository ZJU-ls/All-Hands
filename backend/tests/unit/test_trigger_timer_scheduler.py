"""Unit tests · execution/triggers/timer_scheduler.py.

Contract (spec § 5.1):
- reload() replaces jobs to mirror enabled timer-kind triggers
- disabled triggers get no job
- event-kind triggers are never scheduled
- invalid cron: logged and skipped (no crash)
- the scheduler does not fire before start() and stops cleanly on shutdown()
"""

from __future__ import annotations

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
from allhands.execution.triggers.timer_scheduler import TimerScheduler


def _trigger(
    id_: str,
    *,
    kind: TriggerKind = TriggerKind.TIMER,
    enabled: bool = True,
    cron: str | None = "0 8 * * *",
) -> Trigger:
    return Trigger(
        id=id_,
        name=id_,
        kind=kind,
        enabled=enabled,
        timer=TimerSpec(cron=cron or "0 0 * * *") if kind is TriggerKind.TIMER else None,
        event=EventPattern(type="x") if kind is TriggerKind.EVENT else None,
        action=TriggerAction(type=TriggerActionType.NOTIFY_USER, message="m"),
        created_at=datetime.now(UTC),
        created_by="test",
    )


def _fire_stub(trigger: Trigger) -> TriggerFire:
    return TriggerFire(
        id="fire_stub",
        trigger_id=trigger.id,
        fired_at=datetime.now(UTC),
        source=TriggerFireSource.TIMER,
        action_snapshot=trigger.action,
        status=TriggerFireStatus.DISPATCHED,
    )


async def _fire(trigger: Trigger, source: TriggerFireSource) -> TriggerFire:
    return _fire_stub(trigger)


async def _fetch(trigger_id: str) -> Trigger | None:
    return None


@pytest.mark.asyncio
async def test_reload_schedules_enabled_timer_triggers() -> None:
    sch = TimerScheduler(fire_callback=_fire, fetch_callback=_fetch)
    await sch.start()
    a = _trigger("a")
    b = _trigger("b", enabled=False)
    c = _trigger("c", kind=TriggerKind.EVENT)
    await sch.reload([a, b, c])
    assert sch.job_ids() == ["a"]
    await sch.shutdown()


@pytest.mark.asyncio
async def test_reload_drops_removed_triggers() -> None:
    sch = TimerScheduler(fire_callback=_fire, fetch_callback=_fetch)
    await sch.start()
    await sch.reload([_trigger("a"), _trigger("b")])
    assert set(sch.job_ids()) == {"a", "b"}
    await sch.reload([_trigger("a")])
    assert sch.job_ids() == ["a"]
    await sch.shutdown()


@pytest.mark.asyncio
async def test_invalid_cron_is_skipped_not_crashed() -> None:
    sch = TimerScheduler(fire_callback=_fire, fetch_callback=_fetch)
    await sch.start()
    bad = _trigger("bad", cron="not a cron")
    good = _trigger("good")
    await sch.reload([bad, good])
    assert sch.job_ids() == ["good"]
    await sch.shutdown()


@pytest.mark.asyncio
async def test_start_and_shutdown_idempotent() -> None:
    sch = TimerScheduler(fire_callback=_fire, fetch_callback=_fetch)
    await sch.start()
    await sch.start()  # no-op
    await sch.shutdown()
    await sch.shutdown()  # no-op
