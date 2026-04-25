"""Observability domain model — single-row bootstrap config + summary projection.

Spec: `docs/specs/agent-design/2026-04-18-observatory.md` § 4.2, § 6.2.

`ObservabilityConfig` mirrors the `observability_config` table (migration 0012);
`ObservatorySummary` is the projection the `/observatory` page renders
(aggregate counts over existing events + runs, not a new persisted aggregate).

v0 stores `secret_key` / `admin_password` in plaintext columns to match the
existing providers.api_key convention; AES-256-GCM wrapping is deferred until a
project-wide secret helper lands (spec § 4.1 contract unchanged).
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class BootstrapStatus(StrEnum):
    """Lifecycle states of the embedded Langfuse bootstrap flow."""

    PENDING = "pending"  # container not yet healthy / first boot
    OK = "ok"  # admin + org + project + keys confirmed
    FAILED = "failed"  # gave up after retries; UI shows warning banner
    EXTERNAL = "external"  # user pointed at their own Langfuse via .env


class ObservabilityConfig(BaseModel):
    """Bootstrap state + credentials for the Langfuse link.

    `observability_enabled` is derived: true when status is OK or EXTERNAL.
    The handler (observability/tracing.py `get_langfuse_callback_handler`)
    reads this to decide whether to attach spans to agent runs.
    """

    public_key: str | None = None
    secret_key: str | None = None
    host: str | None = None
    org_id: str | None = None
    project_id: str | None = None
    admin_email: str | None = None
    admin_password: str | None = None
    bootstrap_status: BootstrapStatus = BootstrapStatus.PENDING
    bootstrap_error: str | None = None
    bootstrapped_at: datetime | None = None
    updated_at: datetime | None = None
    # System-wide toggle for LLM-summarised conversation titles. When False
    # (default) the platform falls back to a truncated copy of the user's
    # first message. The flag lives on this row because the v1 platform has
    # no separate ``system_config`` table; ADR follow-up may extract it.
    auto_title_enabled: bool = False

    @property
    def observability_enabled(self) -> bool:
        return self.bootstrap_status in (BootstrapStatus.OK, BootstrapStatus.EXTERNAL)


class ObservatoryEmployeeBreakdown(BaseModel):
    employee_id: str
    employee_name: str
    runs_count: int = 0

    model_config = {"frozen": True}


class ObservatorySummary(BaseModel):
    """Left-pane summary rendered on `/observatory` (spec § 6.2).

    Aggregated in one pass from `events` + `tasks` + config so the page does
    not have to fan out across REST endpoints.
    """

    traces_total: int = 0
    failure_rate_24h: float = 0.0
    latency_p50_s: float = 0.0
    avg_tokens_per_run: int = 0
    by_employee: list[ObservatoryEmployeeBreakdown] = Field(default_factory=list)
    observability_enabled: bool = False
    bootstrap_status: BootstrapStatus = BootstrapStatus.PENDING
    bootstrap_error: str | None = None
    host: str | None = None

    model_config = {"frozen": True}


class RunStatus(StrEnum):
    """Lifecycle of a single agent run as reconstructed by the trace viewer.

    Derived — not persisted. A run is ``succeeded`` when a ``run.completed``
    event landed, ``failed`` when a ``run.failed`` event landed, ``running``
    otherwise (start event seen but no terminator yet).
    """

    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TurnUserInput(BaseModel):
    kind: Literal["user_input"] = "user_input"
    content: str
    ts: datetime

    model_config = {"frozen": True}


class TurnThinking(BaseModel):
    kind: Literal["thinking"] = "thinking"
    content: str
    ts: datetime

    model_config = {"frozen": True}


class TurnToolCall(BaseModel):
    kind: Literal["tool_call"] = "tool_call"
    tool_call_id: str
    name: str
    args: object
    result: object | None = None
    error: str | None = None
    ts_called: datetime
    ts_returned: datetime | None = None

    model_config = {"frozen": True}


class TurnMessage(BaseModel):
    kind: Literal["message"] = "message"
    content: str
    ts: datetime

    model_config = {"frozen": True}


Turn = TurnUserInput | TurnThinking | TurnToolCall | TurnMessage


class RunTokenUsage(BaseModel):
    prompt: int = 0
    completion: int = 0
    total: int = 0

    model_config = {"frozen": True}


class RunError(BaseModel):
    message: str
    kind: str = "unknown"

    model_config = {"frozen": True}


class RunDetail(BaseModel):
    """Full run trace projection returned by ``ObservatoryService.get_run_detail``.

    Reconstructed from ``messages`` (filtered by ``parent_run_id``) and
    ``events`` (``run.started`` / ``run.completed`` / ``run.failed``). The UI
    renders this as the RunTracePanel — drawer, standalone page, and the
    inline block on ``/tasks/[id]`` all share the same shape.
    """

    run_id: str
    task_id: str | None = None
    conversation_id: str
    employee_id: str | None = None
    employee_name: str | None = None
    status: RunStatus = RunStatus.RUNNING
    started_at: datetime
    finished_at: datetime | None = None
    duration_s: float | None = None
    tokens: RunTokenUsage = Field(default_factory=RunTokenUsage)
    error: RunError | None = None
    turns: list[Turn] = Field(default_factory=list)

    model_config = {"frozen": True}


class TraceSummary(BaseModel):
    """Row in the `observatory.query_traces` result list (spec § 7.1).

    Deliberately trace_id-addressable so the Lead Agent can answer
    'how many runs did writer do last week' and hand back clickable ids.
    """

    trace_id: str
    employee_id: str | None = None
    employee_name: str | None = None
    status: str = "ok"  # "ok" | "failed"
    duration_s: float | None = None
    tokens: int = 0
    started_at: datetime

    model_config = {"frozen": True}


__all__ = [
    "BootstrapStatus",
    "ObservabilityConfig",
    "ObservatoryEmployeeBreakdown",
    "ObservatorySummary",
    "RunDetail",
    "RunError",
    "RunStatus",
    "RunTokenUsage",
    "TraceSummary",
    "Turn",
    "TurnMessage",
    "TurnThinking",
    "TurnToolCall",
    "TurnUserInput",
]
