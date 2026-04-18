"""Unit tests · TriggerService (CRUD + fire_now).

Uses the FakeRepos from test_trigger_executor style for isolation.
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
    TriggerFireStatus,
    TriggerKind,
)
from allhands.services.trigger_service import (
    TriggerNotFoundError,
    TriggerService,
)


class _FakeTriggerRepo:
    def __init__(self) -> None:
        self.store: dict[str, Trigger] = {}

    async def get(self, trigger_id: str) -> Trigger | None:
        return self.store.get(trigger_id)

    async def list_all(self) -> list[Trigger]:
        return sorted(self.store.values(), key=lambda t: t.created_at, reverse=True)

    async def list_by_kind(self, kind: str, enabled_only: bool = False) -> list[Trigger]:
        out = [t for t in self.store.values() if t.kind.value == kind]
        if enabled_only:
            out = [t for t in out if t.enabled]
        return out

    async def upsert(self, trigger: Trigger) -> Trigger:
        self.store[trigger.id] = trigger
        return trigger

    async def delete(self, trigger_id: str) -> None:
        self.store.pop(trigger_id, None)


class _FakeFireRepo:
    def __init__(self) -> None:
        self.fires: list[TriggerFire] = []
        self.window_count = 0

    async def get(self, fire_id: str) -> TriggerFire | None:
        return next((f for f in self.fires if f.id == fire_id), None)

    async def list_for_trigger(self, trigger_id: str, limit: int = 50) -> list[TriggerFire]:
        return [f for f in self.fires if f.trigger_id == trigger_id][:limit]

    async def upsert(self, fire: TriggerFire) -> TriggerFire:
        self.fires = [f for f in self.fires if f.id != fire.id]
        self.fires.append(fire)
        return fire

    async def count_in_window(self, seconds: int) -> int:
        return self.window_count


def _svc(handlers: dict[TriggerActionType, object] | None = None) -> TriggerService:
    return TriggerService(
        trigger_repo=_FakeTriggerRepo(),
        fire_repo=_FakeFireRepo(),
        action_handlers=handlers,  # type: ignore[arg-type]
    )


@pytest.mark.asyncio
async def test_create_and_get() -> None:
    svc = _svc()
    action = TriggerAction(
        type=TriggerActionType.NOTIFY_USER,
        message="hello",
    )
    trigger = await svc.create(
        name="daily",
        kind=TriggerKind.TIMER,
        action=action,
        timer=TimerSpec(cron="0 8 * * *"),
    )
    got = await svc.get(trigger.id)
    assert got.name == "daily"
    assert got.kind is TriggerKind.TIMER


@pytest.mark.asyncio
async def test_get_missing_raises() -> None:
    svc = _svc()
    with pytest.raises(TriggerNotFoundError):
        await svc.get("nope")


@pytest.mark.asyncio
async def test_list_all_ordered() -> None:
    svc = _svc()
    action = TriggerAction(type=TriggerActionType.NOTIFY_USER, message="a")
    await svc.create(
        name="a",
        kind=TriggerKind.TIMER,
        action=action,
        timer=TimerSpec(cron="* * * * *"),
    )
    await svc.create(
        name="b",
        kind=TriggerKind.TIMER,
        action=action,
        timer=TimerSpec(cron="* * * * *"),
    )
    out = await svc.list_all()
    assert len(out) == 2


@pytest.mark.asyncio
async def test_update_partial() -> None:
    svc = _svc()
    action = TriggerAction(type=TriggerActionType.NOTIFY_USER, message="a")
    t = await svc.create(
        name="a",
        kind=TriggerKind.TIMER,
        action=action,
        timer=TimerSpec(cron="* * * * *"),
    )
    updated = await svc.update(t.id, name="renamed", min_interval_seconds=600)
    assert updated.name == "renamed"
    assert updated.min_interval_seconds == 600
    # action/timer unchanged
    assert updated.action.message == "a"


@pytest.mark.asyncio
async def test_toggle_clears_streak_on_enable() -> None:
    repo = _FakeTriggerRepo()
    # seed with a disabled trigger that was auto-disabled
    t = Trigger(
        id="trg_x",
        name="x",
        kind=TriggerKind.TIMER,
        timer=TimerSpec(cron="* * * * *"),
        action=TriggerAction(type=TriggerActionType.NOTIFY_USER, message="m"),
        enabled=False,
        fires_failed_streak=3,
        auto_disabled_reason="3 consecutive failures: X",
        created_at=datetime.now(UTC),
        created_by="test",
    )
    await repo.upsert(t)
    svc = TriggerService(trigger_repo=repo, fire_repo=_FakeFireRepo())
    out = await svc.toggle(t.id, enabled=True)
    assert out.enabled is True
    assert out.fires_failed_streak == 0
    assert out.auto_disabled_reason is None


@pytest.mark.asyncio
async def test_delete_removes() -> None:
    svc = _svc()
    t = await svc.create(
        name="a",
        kind=TriggerKind.EVENT,
        action=TriggerAction(type=TriggerActionType.NOTIFY_USER, message="m"),
        event=EventPattern(type="some.event"),
    )
    await svc.delete(t.id)
    with pytest.raises(TriggerNotFoundError):
        await svc.get(t.id)


@pytest.mark.asyncio
async def test_delete_missing_raises() -> None:
    svc = _svc()
    with pytest.raises(TriggerNotFoundError):
        await svc.delete("missing")


@pytest.mark.asyncio
async def test_fire_now_dispatches_through_handler() -> None:
    received: list[str] = []

    async def handler(action: TriggerAction, rendered: str, trigger_id: str) -> str | None:
        received.append(rendered)
        return "run_123"

    repo = _FakeTriggerRepo()
    fires = _FakeFireRepo()
    svc = TriggerService(
        trigger_repo=repo,
        fire_repo=fires,
        action_handlers={TriggerActionType.NOTIFY_USER: handler},
    )
    t = await svc.create(
        name="a",
        kind=TriggerKind.TIMER,
        action=TriggerAction(
            type=TriggerActionType.NOTIFY_USER,
            message="{{@today}} report",
        ),
        timer=TimerSpec(cron="* * * * *"),
    )
    fire = await svc.fire_now(t.id)
    assert fire.status is TriggerFireStatus.DISPATCHED
    assert received and received[0].endswith("report")
