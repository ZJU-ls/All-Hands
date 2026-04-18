"""Five pure defense predicates — the § 7 "漏一个 = 本 spec 不通过" floor.

Each function is a pure predicate over in-memory state so the executor can
compose them without threading repos through the helpers. IO-bound inputs
(global fire count, ancestor chain lookup) are passed in by the caller.

See docs/specs/agent-design/2026-04-18-triggers.md § 7.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from allhands.core import Trigger

MAX_FAILED_STREAK = 3
DEFAULT_MAX_FIRES_PER_MINUTE = 60
GLOBAL_WINDOW_SECONDS = 60


def passes_rate_limit_per_trigger(trigger: Trigger, now: datetime) -> bool:
    """§ 7.1 — drop fire if within min_interval_seconds of last_fired_at.

    Disabled triggers fail-closed here too (never fire). Returns True when
    the fire is allowed to proceed.
    """
    if trigger.last_fired_at is None:
        return True
    elapsed = now - trigger.last_fired_at
    return elapsed >= timedelta(seconds=trigger.min_interval_seconds)


def passes_global_rate_limit(
    fires_last_minute: int,
    max_per_minute: int = DEFAULT_MAX_FIRES_PER_MINUTE,
) -> bool:
    """§ 7.4 — sliding-window counter. True if below the cap."""
    return fires_last_minute < max_per_minute


def detects_cycle(
    trigger_id: str,
    event_trigger_id: str | None,
    ancestor_trigger_ids: frozenset[str] | None = None,
) -> bool:
    """§ 7.3 — return True if firing would form a trigger cycle.

    Two checks:
      1. event.trigger_id == self.id → the event we're about to react to was
         produced by our own previous fire
      2. self.id appears in the ancestor chain (follow-up artifact events
         produced by a run that was kicked off by this trigger earlier)
    """
    if event_trigger_id == trigger_id:
        return True
    return bool(ancestor_trigger_ids and trigger_id in ancestor_trigger_ids)


def should_auto_disable(fires_failed_streak: int) -> bool:
    """§ 7.2 — MAX_FAILED_STREAK consecutive failures disables the trigger."""
    return fires_failed_streak >= MAX_FAILED_STREAK


def triggers_globally_paused(paused_flag: bool) -> bool:
    """§ 7.5 — single boolean read. Separate fn for symmetry + testability."""
    return paused_flag


def utc_now() -> datetime:
    return datetime.now(UTC)
