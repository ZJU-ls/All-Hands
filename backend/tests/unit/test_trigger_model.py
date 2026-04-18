"""Unit tests · core/trigger.py.

Invariants (per triggers spec § 3):
- Trigger(kind=timer) requires TimerSpec, rejects EventPattern
- Trigger(kind=event) requires EventPattern, rejects TimerSpec
- TriggerAction per-type field requirements
- min_interval_seconds enforces 60s floor (spec § 7.1)
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from allhands.core import (
    DEFAULT_MIN_INTERVAL_SECONDS,
    MIN_INTERVAL_SECONDS,
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


def _now() -> datetime:
    return datetime.now(UTC)


def _valid_action() -> TriggerAction:
    return TriggerAction(
        type=TriggerActionType.NOTIFY_USER,
        channel="cockpit",
        message="hi",
    )


def test_timer_trigger_happy_path() -> None:
    t = Trigger(
        id="trg_1",
        name="daily",
        kind=TriggerKind.TIMER,
        timer=TimerSpec(cron="0 8 * * *", timezone="UTC"),
        action=_valid_action(),
        created_at=_now(),
        created_by="system",
    )
    assert t.enabled is True
    assert t.min_interval_seconds == DEFAULT_MIN_INTERVAL_SECONDS
    assert t.timer is not None
    assert t.timer.cron == "0 8 * * *"


def test_event_trigger_happy_path() -> None:
    t = Trigger(
        id="trg_2",
        name="on changelog update",
        kind=TriggerKind.EVENT,
        event=EventPattern(type="artifact.updated", filter={"name_pattern": "**/CHANGELOG*"}),
        action=_valid_action(),
        created_at=_now(),
        created_by="lead_agent",
    )
    assert t.event is not None
    assert t.event.type == "artifact.updated"


def test_timer_kind_without_timer_spec_rejected() -> None:
    with pytest.raises(ValueError, match="kind=timer requires timer spec"):
        Trigger(
            id="trg_3",
            name="bad",
            kind=TriggerKind.TIMER,
            action=_valid_action(),
            created_at=_now(),
            created_by="system",
        )


def test_timer_with_event_spec_rejected() -> None:
    with pytest.raises(ValueError, match="kind=timer cannot have event spec"):
        Trigger(
            id="trg_4",
            name="bad",
            kind=TriggerKind.TIMER,
            timer=TimerSpec(cron="* * * * *"),
            event=EventPattern(type="noise"),
            action=_valid_action(),
            created_at=_now(),
            created_by="system",
        )


def test_event_kind_without_event_pattern_rejected() -> None:
    with pytest.raises(ValueError, match="kind=event requires event pattern"):
        Trigger(
            id="trg_5",
            name="bad",
            kind=TriggerKind.EVENT,
            action=_valid_action(),
            created_at=_now(),
            created_by="system",
        )


def test_min_interval_floor_60s() -> None:
    with pytest.raises(ValueError, match="greater than or equal to"):
        Trigger(
            id="trg_6",
            name="too-fast",
            kind=TriggerKind.TIMER,
            timer=TimerSpec(cron="* * * * *"),
            action=_valid_action(),
            min_interval_seconds=MIN_INTERVAL_SECONDS - 1,
            created_at=_now(),
            created_by="system",
        )


def test_dispatch_employee_action_requires_fields() -> None:
    with pytest.raises(ValueError, match="dispatch_employee requires"):
        TriggerAction(type=TriggerActionType.DISPATCH_EMPLOYEE)
    # employee_id alone is not enough
    with pytest.raises(ValueError, match="dispatch_employee requires"):
        TriggerAction(
            type=TriggerActionType.DISPATCH_EMPLOYEE,
            employee_id="emp_1",
        )
    # ok
    TriggerAction(
        type=TriggerActionType.DISPATCH_EMPLOYEE,
        employee_id="emp_1",
        task_template="summarize {{@yesterday}}",
    )


def test_continue_conversation_action_requires_fields() -> None:
    with pytest.raises(ValueError, match="continue_conversation requires"):
        TriggerAction(type=TriggerActionType.CONTINUE_CONVERSATION)
    TriggerAction(
        type=TriggerActionType.CONTINUE_CONVERSATION,
        conversation_id="conv_1",
        message_template="reminder",
    )


def test_invoke_tool_action_requires_tool_id() -> None:
    with pytest.raises(ValueError, match="invoke_tool requires tool_id"):
        TriggerAction(type=TriggerActionType.INVOKE_TOOL)
    TriggerAction(type=TriggerActionType.INVOKE_TOOL, tool_id="t_1")


def test_notify_user_action_requires_message() -> None:
    with pytest.raises(ValueError, match="notify_user requires message"):
        TriggerAction(type=TriggerActionType.NOTIFY_USER)
    TriggerAction(type=TriggerActionType.NOTIFY_USER, message="hi")


def test_trigger_fire_has_defaults() -> None:
    fire = TriggerFire(
        id="f_1",
        trigger_id="trg_1",
        fired_at=_now(),
        source=TriggerFireSource.MANUAL,
        action_snapshot=_valid_action(),
    )
    assert fire.status is TriggerFireStatus.QUEUED
    assert fire.event_payload is None
    assert fire.run_id is None


def test_event_envelope_minimal() -> None:
    e = EventEnvelope(
        id="evt_1",
        kind="run.started",
        payload={"run_id": "r1"},
        published_at=_now(),
    )
    assert e.trigger_id is None
    assert e.payload["run_id"] == "r1"


def test_trigger_is_frozen() -> None:
    t = Trigger(
        id="trg_x",
        name="n",
        kind=TriggerKind.TIMER,
        timer=TimerSpec(cron="* * * * *"),
        action=_valid_action(),
        created_at=_now(),
        created_by="system",
    )
    with pytest.raises(ValueError, match="frozen"):
        t.name = "other"  # type: ignore[misc]
