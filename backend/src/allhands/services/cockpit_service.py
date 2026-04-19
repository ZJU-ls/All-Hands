"""CockpitService — workspace-level aggregate view.

Spec: docs/specs/agent-design/2026-04-18-cockpit.md § 4.1.

Aggregates existing repos into a single ``WorkspaceSummary``. Runtime state
that has no persistence yet (active runs, health, token usage, pause state)
is provided via injected callbacks so this service stays pure.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Literal, NamedTuple

from allhands.core import (
    ActiveRunCard,
    ActivityEvent,
    ComponentStatus,
    ConvCard,
    HealthSnapshot,
    WorkspaceSummary,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable

    from allhands.core import EventEnvelope
    from allhands.persistence.repositories import (
        ArtifactRepo,
        ConfirmationRepo,
        ConversationRepo,
        EmployeeRepo,
        EventRepo,
        TaskRepo,
        TriggerRepo,
    )


ACTIVITY_EVENT_KINDS = (
    "run.",
    "artifact.",
    "trigger.",
    "confirmation.",
    "mcp.",
    "task.",
)


class TokenStats(NamedTuple):
    prompt: int
    completion: int
    estimated_cost_usd: float


class PauseState(NamedTuple):
    paused: bool
    reason: str | None
    paused_at: datetime | None


def _default_health() -> HealthSnapshot:
    return HealthSnapshot(
        gateway=ComponentStatus(name="gateway", status="ok"),
        mcp_servers=ComponentStatus(name="mcp", status="ok"),
        langfuse=ComponentStatus(name="langfuse", status="ok"),
        db=ComponentStatus(name="db", status="ok"),
        triggers=ComponentStatus(name="triggers", status="ok"),
    )


def _default_pause_state() -> PauseState:
    return PauseState(paused=False, reason=None, paused_at=None)


def _default_token_stats() -> TokenStats:
    return TokenStats(prompt=0, completion=0, estimated_cost_usd=0.0)


def _event_to_activity(e: EventEnvelope) -> ActivityEvent:
    summary = _summarize_event(e)
    severity: Literal["info", "warn", "error"] = _valid_severity(e.severity)
    return ActivityEvent(
        id=e.id,
        ts=e.published_at,
        kind=e.kind,
        actor=e.actor,
        subject=e.subject,
        summary=summary,
        severity=severity,
        link=e.link,
    )


def _valid_severity(s: str) -> Literal["info", "warn", "error"]:
    if s == "warn":
        return "warn"
    if s == "error":
        return "error"
    return "info"


def _summarize_event(e: EventEnvelope) -> str:
    if "summary" in e.payload and isinstance(e.payload["summary"], str):
        return e.payload["summary"]
    # Fallback: "<kind> <subject>"
    bits = [e.kind]
    if e.subject:
        bits.append(e.subject)
    return " ".join(bits)


class CockpitService:
    """Aggregates WorkspaceSummary from repos + injected runtime callbacks.

    Runtime callbacks are keyword-only and default to no-op producers so unit
    tests can omit them. The integration layer (slice 2) wires real providers
    backed by run registry / observability / confirmation gate.
    """

    def __init__(
        self,
        *,
        event_repo: EventRepo,
        confirmation_repo: ConfirmationRepo,
        employee_repo: EmployeeRepo,
        conversation_repo: ConversationRepo,
        trigger_repo: TriggerRepo,
        artifact_repo: ArtifactRepo,
        task_repo: TaskRepo | None = None,
        workspace_id: str = "default",
        active_runs_provider: Callable[[], list[ActiveRunCard]] | None = None,
        health_provider: Callable[[], HealthSnapshot] | None = None,
        token_stats_provider: Callable[[datetime], Awaitable[TokenStats]] | None = None,
        pause_state_provider: Callable[[], PauseState] | None = None,
    ) -> None:
        self._events = event_repo
        self._confirmations = confirmation_repo
        self._employees = employee_repo
        self._conversations = conversation_repo
        self._triggers = trigger_repo
        self._artifacts = artifact_repo
        self._tasks = task_repo
        self._ws = workspace_id
        self._active_runs = active_runs_provider or (list)
        self._health = health_provider or _default_health
        self._tokens = token_stats_provider
        self._pause = pause_state_provider or _default_pause_state

    async def build_summary(self, *, now: datetime | None = None) -> WorkspaceSummary:
        ts_now = now or datetime.now(UTC)
        day_start = ts_now - timedelta(hours=24)
        week_start = ts_now - timedelta(days=7)
        hour_start = ts_now - timedelta(hours=1)

        employees = await self._employees.list_all()
        conversations = await self._conversations.list_all()
        triggers = await self._triggers.list_all()
        pending_confs = await self._confirmations.list_pending()
        artifacts = await self._artifacts.list_for_workspace(self._ws, limit=10000)
        recent_events = await self._events.list_recent(
            limit=20,
            workspace_id=self._ws,
            kind_prefixes=list(ACTIVITY_EVENT_KINDS),
        )
        failed_recently = await self._events.count_since(
            since=hour_start,
            workspace_id=self._ws,
            kind_prefixes=["run.failed"],
        )

        active_runs = list(self._active_runs())
        health = self._health()
        pause = self._pause()

        if self._tokens is not None:
            tok = await self._tokens(day_start)
        else:
            tok = _default_token_stats()

        tasks_active = 0
        tasks_needs_user = 0
        if self._tasks is not None:
            from allhands.core import PENDING_USER_STATUSES as _PENDING

            tasks_active = await self._tasks.count_active(self._ws)
            needs_user_tasks = await self._tasks.list_all(
                workspace_id=self._ws,
                statuses=list(_PENDING),
                limit=500,
            )
            tasks_needs_user = len(needs_user_tasks)

        convs_today = sum(1 for c in conversations if c.created_at >= day_start)
        artifacts_week = sum(1 for a in artifacts if a.created_at >= week_start)

        # Build recent-conv cards from the 5 most recent conversations.
        # v0 Conversation has no updated_at / message_count yet — use created_at as
        # a fallback timestamp and leave message_count at 0 (will be wired in a
        # follow-up when ConversationRepo exposes the aggregate).
        emp_name_by_id = {e.id: e.name for e in employees}
        recent_conversations = [
            ConvCard(
                id=c.id,
                employee_id=c.employee_id,
                employee_name=emp_name_by_id.get(c.employee_id, c.employee_id),
                title=c.title or "",
                updated_at=c.created_at,
                message_count=0,
            )
            for c in sorted(conversations, key=lambda c: c.created_at, reverse=True)[:5]
        ]

        return WorkspaceSummary(
            employees_total=len(employees),
            runs_active=len(active_runs),
            conversations_today=convs_today,
            artifacts_total=len(artifacts),
            artifacts_this_week_delta=artifacts_week,
            triggers_active=sum(1 for t in triggers if t.enabled),
            tasks_active=tasks_active,
            tasks_needs_user=tasks_needs_user,
            tokens_today_total=tok.prompt + tok.completion,
            tokens_today_prompt=tok.prompt,
            tokens_today_completion=tok.completion,
            estimated_cost_today_usd=tok.estimated_cost_usd,
            health=health,
            confirmations_pending=len(pending_confs),
            runs_failing_recently=failed_recently,
            recent_events=[_event_to_activity(e) for e in recent_events],
            active_runs=active_runs,
            recent_conversations=recent_conversations,
            paused=pause.paused,
            paused_reason=pause.reason,
            paused_at=pause.paused_at,
        )


__all__ = [
    "ACTIVITY_EVENT_KINDS",
    "CockpitService",
    "PauseState",
    "TokenStats",
]
