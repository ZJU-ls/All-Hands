"""Unit tests · TriggerExecutor (spec § 5.3).

Covers:
- Success path: QUEUED → DISPATCHED + run_id, streak reset, stats bumped
- Failure path: QUEUED → FAILED + error_code, streak incremented
- 3rd consecutive failure auto-disables
- All 5 suppressions produce a SUPPRESSED fire with the right error_code
- MANUAL source bypasses per-trigger rate limit
- Missing handler → FAILED(handler_missing)
- Rendering pipes through template vars
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from allhands.core import (
    EventEnvelope,
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
from allhands.execution.triggers.defenses import MAX_FAILED_STREAK
from allhands.execution.triggers.executor import TriggerExecutor


class _FakeTriggerRepo:
    def __init__(self, trigger: Trigger) -> None:
        self.current = trigger
        self.upserts: list[Trigger] = []

    async def get(self, trigger_id: str) -> Trigger | None:
        return self.current if self.current.id == trigger_id else None

    async def list_all(self) -> list[Trigger]:
        return [self.current]

    async def list_by_kind(self, kind: str, enabled_only: bool = False) -> list[Trigger]:
        return [self.current]

    async def upsert(self, trigger: Trigger) -> Trigger:
        self.current = trigger
        self.upserts.append(trigger)
        return trigger

    async def delete(self, trigger_id: str) -> None:
        return None


class _FakeFireRepo:
    def __init__(self, fires_last_minute: int = 0) -> None:
        self.fires: list[TriggerFire] = []
        self.window_count = fires_last_minute

    async def get(self, fire_id: str) -> TriggerFire | None:
        for f in self.fires:
            if f.id == fire_id:
                return f
        return None

    async def list_for_trigger(self, trigger_id: str, limit: int = 50) -> list[TriggerFire]:
        return [f for f in self.fires if f.trigger_id == trigger_id][:limit]

    async def upsert(self, fire: TriggerFire) -> TriggerFire:
        # Remove prior copy (same id) then append — simulate upsert
        self.fires = [f for f in self.fires if f.id != fire.id]
        self.fires.append(fire)
        return fire

    async def count_in_window(self, seconds: int) -> int:
        return self.window_count


def _make_trigger(
    *,
    action: TriggerAction | None = None,
    last_fired_at: datetime | None = None,
    min_interval: int = 300,
    fires_failed_streak: int = 0,
    enabled: bool = True,
) -> Trigger:
    return Trigger(
        id="trg_1",
        name="daily",
        kind=TriggerKind.TIMER,
        timer=TimerSpec(cron="0 8 * * *"),
        action=action
        or TriggerAction(
            type=TriggerActionType.NOTIFY_USER,
            message="{{@today}} report",
        ),
        min_interval_seconds=min_interval,
        enabled=enabled,
        fires_failed_streak=fires_failed_streak,
        last_fired_at=last_fired_at,
        created_at=datetime.now(UTC),
        created_by="test",
    )


@pytest.mark.asyncio
async def test_success_path_dispatched_and_streak_reset() -> None:
    trigger = _make_trigger(fires_failed_streak=2)
    trepo = _FakeTriggerRepo(trigger)
    frepo = _FakeFireRepo()
    calls: list[str] = []

    async def notify(action: TriggerAction, rendered: str, trigger_id: str) -> str | None:
        calls.append(rendered)
        return None

    execu = TriggerExecutor(
        trigger_repo=trepo,
        fire_repo=frepo,
        action_handlers={TriggerActionType.NOTIFY_USER: notify},
    )
    fire = await execu.fire(trigger, source=TriggerFireSource.TIMER)

    assert fire.status is TriggerFireStatus.DISPATCHED
    assert calls and calls[0].endswith("report")
    # streak reset
    assert trepo.current.fires_failed_streak == 0
    assert trepo.current.fires_total == 1


@pytest.mark.asyncio
async def test_failure_increments_streak() -> None:
    trigger = _make_trigger(fires_failed_streak=0)
    trepo = _FakeTriggerRepo(trigger)
    frepo = _FakeFireRepo()

    async def bad(action: TriggerAction, rendered: str, trigger_id: str) -> str | None:
        raise RuntimeError("downstream down")

    execu = TriggerExecutor(
        trigger_repo=trepo,
        fire_repo=frepo,
        action_handlers={TriggerActionType.NOTIFY_USER: bad},
    )
    fire = await execu.fire(trigger, source=TriggerFireSource.TIMER)

    assert fire.status is TriggerFireStatus.FAILED
    assert fire.error_code == "RuntimeError"
    assert "downstream down" in (fire.error_detail or "")
    assert trepo.current.fires_failed_streak == 1
    assert trepo.current.enabled is True  # not yet auto-disabled


@pytest.mark.asyncio
async def test_third_failure_auto_disables() -> None:
    trigger = _make_trigger(fires_failed_streak=MAX_FAILED_STREAK - 1)
    trepo = _FakeTriggerRepo(trigger)
    frepo = _FakeFireRepo()

    async def bad(action: TriggerAction, rendered: str, trigger_id: str) -> str | None:
        raise RuntimeError("still broken")

    execu = TriggerExecutor(
        trigger_repo=trepo,
        fire_repo=frepo,
        action_handlers={TriggerActionType.NOTIFY_USER: bad},
    )
    await execu.fire(trigger, source=TriggerFireSource.TIMER)

    assert trepo.current.enabled is False
    assert "consecutive failures" in (trepo.current.auto_disabled_reason or "")


@pytest.mark.asyncio
async def test_suppress_paused() -> None:
    execu = TriggerExecutor(
        trigger_repo=_FakeTriggerRepo(_make_trigger()),
        fire_repo=_FakeFireRepo(),
        action_handlers={},
        paused_getter=lambda: True,
    )
    fire = await execu.fire(_make_trigger(), source=TriggerFireSource.TIMER)
    assert fire.status is TriggerFireStatus.SUPPRESSED
    assert fire.error_code == "triggers_paused"


@pytest.mark.asyncio
async def test_suppress_rate_limit_per_trigger() -> None:
    now = datetime.now(UTC)
    trigger = _make_trigger(last_fired_at=now - timedelta(seconds=10))
    execu = TriggerExecutor(
        trigger_repo=_FakeTriggerRepo(trigger),
        fire_repo=_FakeFireRepo(),
        action_handlers={},
    )
    fire = await execu.fire(trigger, source=TriggerFireSource.TIMER)
    assert fire.status is TriggerFireStatus.SUPPRESSED
    assert fire.error_code == "rate_limit_per_trigger"


@pytest.mark.asyncio
async def test_manual_source_bypasses_per_trigger_rate_limit() -> None:
    now = datetime.now(UTC)
    trigger = _make_trigger(last_fired_at=now - timedelta(seconds=10))
    trepo = _FakeTriggerRepo(trigger)
    frepo = _FakeFireRepo()

    async def notify(action: TriggerAction, rendered: str, trigger_id: str) -> str | None:
        return None

    execu = TriggerExecutor(
        trigger_repo=trepo,
        fire_repo=frepo,
        action_handlers={TriggerActionType.NOTIFY_USER: notify},
    )
    fire = await execu.fire(trigger, source=TriggerFireSource.MANUAL)
    assert fire.status is TriggerFireStatus.DISPATCHED


@pytest.mark.asyncio
async def test_suppress_global_rate_limit() -> None:
    trigger = _make_trigger()
    frepo = _FakeFireRepo(fires_last_minute=60)  # at cap
    execu = TriggerExecutor(
        trigger_repo=_FakeTriggerRepo(trigger),
        fire_repo=frepo,
        action_handlers={},
    )
    fire = await execu.fire(trigger, source=TriggerFireSource.TIMER)
    assert fire.status is TriggerFireStatus.SUPPRESSED
    assert fire.error_code == "global_rate_limit"


@pytest.mark.asyncio
async def test_suppress_cycle_self_origin() -> None:
    trigger = _make_trigger()
    execu = TriggerExecutor(
        trigger_repo=_FakeTriggerRepo(trigger),
        fire_repo=_FakeFireRepo(),
        action_handlers={},
    )
    fire = await execu.fire(
        trigger,
        source=TriggerFireSource.EVENT,
        event_payload={"trigger_id": trigger.id, "run_id": "r1"},
    )
    assert fire.status is TriggerFireStatus.SUPPRESSED
    assert fire.error_code == "cycle"


@pytest.mark.asyncio
async def test_suppress_cycle_ancestor_chain() -> None:
    trigger = _make_trigger()

    async def ancestors(run_id: str | None) -> frozenset[str]:
        return frozenset({"trg_root", trigger.id, "trg_middle"})

    execu = TriggerExecutor(
        trigger_repo=_FakeTriggerRepo(trigger),
        fire_repo=_FakeFireRepo(),
        action_handlers={},
        ancestor_chain_getter=ancestors,
    )
    fire = await execu.fire(
        trigger,
        source=TriggerFireSource.EVENT,
        event_payload={"trigger_id": "trg_other", "run_id": "r1"},
    )
    assert fire.status is TriggerFireStatus.SUPPRESSED
    assert fire.error_code == "cycle"


@pytest.mark.asyncio
async def test_missing_handler_fails_cleanly() -> None:
    trigger = _make_trigger()
    trepo = _FakeTriggerRepo(trigger)
    execu = TriggerExecutor(
        trigger_repo=trepo,
        fire_repo=_FakeFireRepo(),
        action_handlers={},  # empty
    )
    fire = await execu.fire(trigger, source=TriggerFireSource.TIMER)
    assert fire.status is TriggerFireStatus.FAILED
    assert fire.error_code == "handler_missing"


@pytest.mark.asyncio
async def test_dispatch_employee_handler_receives_rendered_task() -> None:
    action = TriggerAction(
        type=TriggerActionType.DISPATCH_EMPLOYEE,
        employee_id="writer",
        task_template="summarize {{@yesterday}}",
    )
    trigger = _make_trigger(action=action)
    trepo = _FakeTriggerRepo(trigger)
    frepo = _FakeFireRepo()

    captured: dict[str, Any] = {}

    async def dispatch(a: TriggerAction, rendered: str, trigger_id: str) -> str | None:
        captured["rendered"] = rendered
        captured["action"] = a
        return "run_abc"

    execu = TriggerExecutor(
        trigger_repo=trepo,
        fire_repo=frepo,
        action_handlers={TriggerActionType.DISPATCH_EMPLOYEE: dispatch},
    )
    fire = await execu.fire(trigger, source=TriggerFireSource.TIMER)

    assert fire.status is TriggerFireStatus.DISPATCHED
    assert fire.run_id == "run_abc"
    assert captured["rendered"].startswith("summarize ")
    assert captured["action"].employee_id == "writer"


def test_event_pattern_reexported() -> None:
    # Soft smoke — ensure imports exposed for scheduler/listener module to use
    assert EventEnvelope is not None
    assert EventPattern is not None
