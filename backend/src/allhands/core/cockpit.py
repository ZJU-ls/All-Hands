"""Cockpit DTOs — workspace-level aggregate view.

Spec: docs/specs/agent-design/2026-04-18-cockpit.md § 3. The cockpit adds no
new persisted tables; these types are pure projections over existing aggregates
(employees / runs / conversations / triggers / artifacts / events / tokens).

ref-src: V01 REPL status bar → one-shot KPI aggregation, no per-panel refetch.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ComponentStatusKind = Literal["ok", "degraded", "down"]

ActivityEventKind = Literal[
    "run.started",
    "run.completed",
    "run.failed",
    "artifact.created",
    "artifact.updated",
    "trigger.fired",
    "trigger.bound",
    "confirmation.pending",
    "confirmation.resolved",
    "mcp.unreachable",
]

ActivityEventSeverity = Literal["info", "warn", "error"]

ActiveRunStatus = Literal["thinking", "calling_tool", "waiting_confirmation", "writing"]


class ComponentStatus(BaseModel):
    name: str
    status: ComponentStatusKind
    detail: str = ""

    model_config = {"frozen": True}


class HealthSnapshot(BaseModel):
    gateway: ComponentStatus
    mcp_servers: ComponentStatus
    db: ComponentStatus
    triggers: ComponentStatus

    model_config = {"frozen": True}


class ActivityEvent(BaseModel):
    id: str
    ts: datetime
    kind: str  # ActivityEventKind enumerated for typing; keep str for forward-compat
    actor: str | None = None
    subject: str | None = None
    summary: str
    severity: ActivityEventSeverity = "info"
    link: str | None = None

    model_config = {"frozen": True}


class ActiveRunCard(BaseModel):
    run_id: str
    employee_id: str
    employee_name: str
    status: ActiveRunStatus
    current_action_summary: str = ""
    iteration: int = 0
    max_iterations: int = 0
    parent_run_id: str | None = None
    depth: int = 0
    started_at: datetime
    trigger_id: str | None = None

    model_config = {"frozen": True}


class ConvCard(BaseModel):
    id: str
    employee_id: str
    employee_name: str
    title: str = ""
    updated_at: datetime
    message_count: int = 0

    model_config = {"frozen": True}


class WorkspaceSummary(BaseModel):
    """Top-of-page snapshot shown in `/` cockpit.

    Aggregated in one pass by `CockpitService.build_summary()` so the front end
    never has to assemble counts from multiple REST endpoints.
    """

    # KPI bar
    employees_total: int = 0
    runs_active: int = 0
    conversations_today: int = 0
    artifacts_total: int = 0
    artifacts_this_week_delta: int = 0
    triggers_active: int = 0
    tasks_active: int = 0
    tasks_needs_user: int = 0
    tokens_today_total: int = 0
    tokens_today_prompt: int = 0
    tokens_today_completion: int = 0
    estimated_cost_today_usd: float = 0.0

    # Health + queues
    health: HealthSnapshot
    confirmations_pending: int = 0
    runs_failing_recently: int = 0

    # Projections
    recent_events: list[ActivityEvent] = Field(default_factory=list)
    active_runs: list[ActiveRunCard] = Field(default_factory=list)
    recent_conversations: list[ConvCard] = Field(default_factory=list)

    # Global pause state
    paused: bool = False
    paused_reason: str | None = None
    paused_at: datetime | None = None

    model_config = {"frozen": True}


__all__ = [
    "ActiveRunCard",
    "ActiveRunStatus",
    "ActivityEvent",
    "ActivityEventKind",
    "ActivityEventSeverity",
    "ComponentStatus",
    "ComponentStatusKind",
    "ConvCard",
    "HealthSnapshot",
    "WorkspaceSummary",
]
