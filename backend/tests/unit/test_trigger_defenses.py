"""Unit tests · 5 defense rules (spec § 7). 漏一个 = 本 spec 不通过."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from allhands.core import (
    TimerSpec,
    Trigger,
    TriggerAction,
    TriggerActionType,
    TriggerKind,
)
from allhands.execution.triggers.defenses import (
    DEFAULT_MAX_FIRES_PER_MINUTE,
    MAX_FAILED_STREAK,
    detects_cycle,
    passes_global_rate_limit,
    passes_rate_limit_per_trigger,
    should_auto_disable,
    triggers_globally_paused,
)


def _trigger(min_interval: int = 300, last_fired_at: datetime | None = None) -> Trigger:
    return Trigger(
        id="trg_1",
        name="t",
        kind=TriggerKind.TIMER,
        timer=TimerSpec(cron="* * * * *"),
        action=TriggerAction(type=TriggerActionType.NOTIFY_USER, message="hi"),
        min_interval_seconds=min_interval,
        last_fired_at=last_fired_at,
        created_at=datetime.now(UTC),
        created_by="test",
    )


# --- § 7.1 rate_limit_per_trigger ---


def test_rate_limit_first_fire_allowed() -> None:
    t = _trigger(last_fired_at=None)
    assert passes_rate_limit_per_trigger(t, datetime.now(UTC)) is True


def test_rate_limit_too_soon_blocked() -> None:
    now = datetime.now(UTC)
    t = _trigger(min_interval=300, last_fired_at=now - timedelta(seconds=100))
    assert passes_rate_limit_per_trigger(t, now) is False


def test_rate_limit_interval_elapsed_allowed() -> None:
    now = datetime.now(UTC)
    t = _trigger(min_interval=300, last_fired_at=now - timedelta(seconds=301))
    assert passes_rate_limit_per_trigger(t, now) is True


# --- § 7.2 auto_disable ---


def test_auto_disable_below_threshold() -> None:
    assert should_auto_disable(0) is False
    assert should_auto_disable(MAX_FAILED_STREAK - 1) is False


def test_auto_disable_at_threshold() -> None:
    assert should_auto_disable(MAX_FAILED_STREAK) is True
    assert should_auto_disable(MAX_FAILED_STREAK + 10) is True


# --- § 7.3 cycle detection ---


def test_cycle_event_from_self() -> None:
    assert detects_cycle("trg_1", event_trigger_id="trg_1") is True


def test_cycle_event_from_other_ok() -> None:
    assert detects_cycle("trg_1", event_trigger_id="trg_other") is False


def test_cycle_no_event_trigger_id() -> None:
    assert detects_cycle("trg_1", event_trigger_id=None) is False


def test_cycle_ancestor_chain() -> None:
    chain = frozenset({"trg_root", "trg_1", "trg_middle"})
    assert detects_cycle("trg_1", event_trigger_id="trg_other", ancestor_trigger_ids=chain) is True


def test_cycle_ancestor_chain_clean() -> None:
    chain = frozenset({"trg_root", "trg_middle"})
    assert detects_cycle("trg_1", event_trigger_id="trg_other", ancestor_trigger_ids=chain) is False


# --- § 7.4 global_rate_limit ---


def test_global_rate_limit_below_cap() -> None:
    assert passes_global_rate_limit(fires_last_minute=DEFAULT_MAX_FIRES_PER_MINUTE - 1) is True


def test_global_rate_limit_at_cap() -> None:
    # spec: "超过" → at cap blocks (> cap). At exactly cap we block too
    # because next fire would be cap+1. Use strict <.
    assert passes_global_rate_limit(fires_last_minute=DEFAULT_MAX_FIRES_PER_MINUTE) is False


def test_global_rate_limit_custom_cap() -> None:
    assert passes_global_rate_limit(fires_last_minute=5, max_per_minute=10) is True
    assert passes_global_rate_limit(fires_last_minute=10, max_per_minute=10) is False


# --- § 7.5 triggers_paused ---


def test_paused_flag() -> None:
    assert triggers_globally_paused(True) is True
    assert triggers_globally_paused(False) is False
