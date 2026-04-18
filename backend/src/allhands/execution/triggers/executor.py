"""TriggerExecutor — the fire() method from spec § 5.3.

Defense-first design: every fire() call runs the § 7 five-gate in order
before any side effect. Action-specific side effects are delegated to
pluggable handlers (ActionHandler Protocol) so the executor stays pure
and testable without real services wired in.

The executor never mutates Trigger in place (domain model is frozen):
updated stats flow through `trigger_repo.upsert(trigger.model_copy(update=...))`.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any, Protocol

from allhands.core import (
    EventPattern,
    Trigger,
    TriggerAction,
    TriggerActionType,
    TriggerFire,
    TriggerFireSource,
    TriggerFireStatus,
)
from allhands.execution.triggers.defenses import (
    DEFAULT_MAX_FIRES_PER_MINUTE,
    GLOBAL_WINDOW_SECONDS,
    detects_cycle,
    passes_global_rate_limit,
    passes_rate_limit_per_trigger,
    should_auto_disable,
    triggers_globally_paused,
    utc_now,
)
from allhands.execution.triggers.templating import (
    build_default_ctx,
    render_template,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from allhands.persistence.repositories import (
        TriggerFireRepo,
        TriggerRepo,
    )


class ActionHandler(Protocol):
    """Dispatches a single TriggerAction after templating.

    Returns the run_id (for dispatch/continue) or None (notify/invoke_tool).
    Raise on failure — the executor translates exceptions to FAILED fires.
    """

    async def __call__(
        self,
        action: TriggerAction,
        rendered_text: str,
        trigger_id: str,
    ) -> str | None: ...


class TriggerExecutor:
    def __init__(
        self,
        trigger_repo: TriggerRepo,
        fire_repo: TriggerFireRepo,
        action_handlers: dict[TriggerActionType, ActionHandler],
        *,
        max_fires_per_minute: int = DEFAULT_MAX_FIRES_PER_MINUTE,
        paused_getter: Callable[[], bool] | None = None,
        ancestor_chain_getter: Callable[[str | None], Awaitable[frozenset[str]]] | None = None,
    ) -> None:
        self._triggers = trigger_repo
        self._fires = fire_repo
        self._handlers = action_handlers
        self._max_per_minute = max_fires_per_minute
        self._paused = paused_getter or (lambda: False)
        self._ancestors = ancestor_chain_getter

    async def fire(
        self,
        trigger: Trigger,
        source: TriggerFireSource,
        event_payload: dict[str, Any] | None = None,
    ) -> TriggerFire:
        now = utc_now()

        suppressed_reason = await self._check_gates(trigger, source, event_payload, now)
        if suppressed_reason is not None:
            return await self._persist_suppressed(
                trigger, source, event_payload, now, suppressed_reason
            )

        rendered_text = self._render(trigger.action, trigger, event_payload, now)

        fire = TriggerFire(
            id=f"fire_{uuid.uuid4().hex[:16]}",
            trigger_id=trigger.id,
            fired_at=now,
            source=source,
            event_payload=event_payload,
            action_snapshot=trigger.action,
            rendered_task=rendered_text,
            status=TriggerFireStatus.QUEUED,
        )
        await self._fires.upsert(fire)

        handler = self._handlers.get(trigger.action.type)
        if handler is None:
            fire = fire.model_copy(
                update={
                    "status": TriggerFireStatus.FAILED,
                    "error_code": "handler_missing",
                    "error_detail": f"no handler for {trigger.action.type.value}",
                }
            )
            await self._fires.upsert(fire)
            await self._bump_failure(trigger, now, fire.error_code or "")
            return fire

        try:
            run_id = await handler(trigger.action, rendered_text, trigger.id)
        except Exception as exc:
            fire = fire.model_copy(
                update={
                    "status": TriggerFireStatus.FAILED,
                    "error_code": type(exc).__name__,
                    "error_detail": str(exc)[:2000],
                }
            )
            await self._fires.upsert(fire)
            await self._bump_failure(trigger, now, fire.error_code or "")
            return fire

        fire = fire.model_copy(
            update={
                "status": TriggerFireStatus.DISPATCHED,
                "run_id": run_id,
            }
        )
        await self._fires.upsert(fire)
        await self._bump_success(trigger, now)
        return fire

    # -- gates ----------------------------------------------------------

    async def _check_gates(
        self,
        trigger: Trigger,
        source: TriggerFireSource,
        event_payload: dict[str, Any] | None,
        now: Any,
    ) -> str | None:
        if triggers_globally_paused(self._paused()):
            return "triggers_paused"
        # MANUAL fires intentionally bypass per-trigger rate limit (§ 8)
        if source is not TriggerFireSource.MANUAL and not passes_rate_limit_per_trigger(
            trigger, now
        ):
            return "rate_limit_per_trigger"
        fires_last_minute = await self._fires.count_in_window(GLOBAL_WINDOW_SECONDS)
        if not passes_global_rate_limit(fires_last_minute, self._max_per_minute):
            return "global_rate_limit"
        event_trigger_id = (event_payload or {}).get("trigger_id")
        ancestors: frozenset[str] | None = None
        if self._ancestors is not None:
            run_id = (event_payload or {}).get("run_id")
            ancestors = await self._ancestors(run_id if isinstance(run_id, str) else None)
        if detects_cycle(
            trigger.id,
            event_trigger_id if isinstance(event_trigger_id, str) else None,
            ancestors,
        ):
            return "cycle"
        return None

    async def _persist_suppressed(
        self,
        trigger: Trigger,
        source: TriggerFireSource,
        event_payload: dict[str, Any] | None,
        now: Any,
        reason: str,
    ) -> TriggerFire:
        fire = TriggerFire(
            id=f"fire_{uuid.uuid4().hex[:16]}",
            trigger_id=trigger.id,
            fired_at=now,
            source=source,
            event_payload=event_payload,
            action_snapshot=trigger.action,
            status=TriggerFireStatus.SUPPRESSED,
            error_code=reason,
        )
        await self._fires.upsert(fire)
        return fire

    # -- rendering ------------------------------------------------------

    def _render(
        self,
        action: TriggerAction,
        trigger: Trigger,
        event_payload: dict[str, Any] | None,
        fired_at: Any,
    ) -> str:
        template = action.task_template or action.message_template or action.message or ""
        ctx = build_default_ctx(
            trigger_name=trigger.name,
            fired_at=fired_at,
            event_payload=event_payload,
        )
        return render_template(template, ctx)

    # -- stats ----------------------------------------------------------

    async def _bump_success(self, trigger: Trigger, now: Any) -> None:
        updated = trigger.model_copy(
            update={
                "fires_total": trigger.fires_total + 1,
                "fires_failed_streak": 0,
                "last_fired_at": now,
            }
        )
        await self._triggers.upsert(updated)

    async def _bump_failure(self, trigger: Trigger, now: Any, error_code: str) -> None:
        new_streak = trigger.fires_failed_streak + 1
        update: dict[str, Any] = {
            "fires_total": trigger.fires_total + 1,
            "fires_failed_streak": new_streak,
            "last_fired_at": now,
        }
        if should_auto_disable(new_streak):
            update["enabled"] = False
            update["auto_disabled_reason"] = f"{new_streak} consecutive failures: {error_code}"
        updated = trigger.model_copy(update=update)
        await self._triggers.upsert(updated)


__all__ = ["ActionHandler", "EventPattern", "TriggerExecutor"]
