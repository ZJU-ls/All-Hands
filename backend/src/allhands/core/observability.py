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
    "TraceSummary",
]
