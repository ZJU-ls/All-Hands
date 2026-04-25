"""Observability domain model — single-row system config + summary projection.

The platform self-instruments via the local ``events`` table (run.* / llm.call /
tool.invoked / tool.returned). Langfuse and the embedded bootstrap flow were
removed in 2026-04-25 — observatory now reads only from local events. The
``observability_config`` row is kept as a singleton system-config holder for
flags like ``auto_title_enabled``; the langfuse credential / bootstrap columns
are dropped via migration 0023.

`ObservatorySummary` is the projection the `/observatory` page renders
(aggregate counts over existing events + runs, not a new persisted aggregate).
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class ObservabilityConfig(BaseModel):
    """Singleton system-config row.

    Now that Langfuse is gone, the only field that drives behavior is
    ``auto_title_enabled``. ``observability_enabled`` always returns True —
    self-instrumentation is unconditional and the trace pipeline can never
    be "off" because it writes to the same DB the rest of the app uses.
    """

    updated_at: datetime | None = None
    auto_title_enabled: bool = False

    @property
    def observability_enabled(self) -> bool:
        return True


class ObservatoryEmployeeBreakdown(BaseModel):
    employee_id: str
    employee_name: str
    runs_count: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0

    model_config = {"frozen": True}


class ObservatoryModelBreakdown(BaseModel):
    """Per-model rollup row · keyed on the resolved ``model_ref`` written
    into the ``run.completed`` payload. Counts every run that hit that
    binding plus the in / out / total token sums.
    """

    model_ref: str
    runs_count: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    estimated_cost_usd: float = 0.0

    model_config = {"frozen": True}


class ObservatoryToolBreakdown(BaseModel):
    """Per-tool rollup · keyed on ``tool_id`` from tool.invoked /
    tool.returned events. Counts every invocation, surfaces the failure
    rate and avg duration so the observatory can highlight unreliable or
    slow tools (Honeycomb / Datadog parity).
    """

    tool_id: str
    invocations: int = 0
    failures: int = 0
    failure_rate: float = 0.0
    avg_duration_s: float = 0.0

    model_config = {"frozen": True}


class ObservatoryErrorBreakdown(BaseModel):
    """Top error categories · groups failed runs by ``error_kind`` so
    the observatory can show "the X kinds of failure happening right now"
    the way Sentry does for exceptions.
    """

    error_kind: str
    count: int = 0
    last_message: str = ""
    last_seen_at: datetime | None = None

    model_config = {"frozen": True}


class ObservatorySummary(BaseModel):
    """Left-pane summary rendered on `/observatory` (spec § 6.2).

    Aggregated in one pass from `events` + `tasks` + config so the page does
    not have to fan out across REST endpoints. Self-instrumented; no
    external tracing backend involved.
    """

    traces_total: int = 0
    failure_rate_24h: float = 0.0
    latency_p50_s: float = 0.0
    latency_p95_s: float = 0.0
    latency_p99_s: float = 0.0
    avg_tokens_per_run: int = 0
    input_tokens_total: int = 0
    output_tokens_total: int = 0
    total_tokens_total: int = 0
    llm_calls_total: int = 0
    estimated_cost_usd: float = 0.0
    by_employee: list[ObservatoryEmployeeBreakdown] = Field(default_factory=list)
    by_model: list[ObservatoryModelBreakdown] = Field(default_factory=list)
    by_tool: list[ObservatoryToolBreakdown] = Field(default_factory=list)
    top_errors: list[ObservatoryErrorBreakdown] = Field(default_factory=list)


class TimeSeriesPoint(BaseModel):
    """One time-bucket of an observatory metric.

    ``ts`` is the bucket start (UTC ISO). ``value`` is the metric value
    aggregated over the bucket — meaning depends on which metric: latency
    p-percentiles use the percentile within the bucket; counts (runs /
    llm_calls) sum; tokens / cost sum; failure_rate is failed/total within
    the bucket. ``count`` is the number of run.* events that contributed,
    surfaced for UI tooltips ("48 runs in this hour").
    """

    ts: datetime
    value: float = 0.0
    count: int = 0

    model_config = {"frozen": True}


class TimeSeries(BaseModel):
    """Bucketed series for the metric drilldown chart.

    Returned by ``GET /api/observatory/series?metric=...&bucket=...``.
    The frontend renders a single-line chart with hover tooltips; missing
    buckets at the start/end of the window are filled with zero-value
    points so the x-axis stays continuous.
    """

    metric: str
    bucket: str  # "1h" | "5m"
    since: datetime
    until: datetime
    points: list[TimeSeriesPoint] = Field(default_factory=list)
    unit: str = ""  # "s" / "tokens" / "USD" / "%"

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


class TurnLLMCall(BaseModel):
    """A single ``model.astream`` round-trip rendered as a timeline segment.

    Sourced from the ``llm.call`` event the chat service emits per turn.
    Carries the model identifier, wall-clock duration, and the per-call
    token split so the trace viewer can show "LLM call #N · gpt-4o-mini ·
    3.2s · in 1.2k / out 420 / total 1.6k".
    """

    kind: Literal["llm_call"] = "llm_call"
    call_index: int
    model_ref: str | None = None
    duration_s: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    ts: datetime

    model_config = {"frozen": True}


Turn = TurnUserInput | TurnThinking | TurnToolCall | TurnMessage | TurnLLMCall


class RunTokenUsage(BaseModel):
    prompt: int = 0
    completion: int = 0
    total: int = 0

    model_config = {"frozen": True}


class RunError(BaseModel):
    message: str
    kind: str = "unknown"

    model_config = {"frozen": True}


class ArtifactSummary(BaseModel):
    """Minimal artifact projection embedded in ``RunDetail``.

    Sourced via ``ArtifactRepo.list_by_run_id`` — every artifact this run
    wrote (``created_by_run_id == run_id``). Lets the trace drawer render
    a "产出制品" panel without a second round-trip.
    """

    id: str
    name: str
    kind: str
    mime_type: str
    version: int
    size_bytes: int = 0
    pinned: bool = False
    created_at: datetime

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
    llm_calls: int = 0
    model_ref: str | None = None
    estimated_cost_usd: float = 0.0
    error: RunError | None = None
    turns: list[Turn] = Field(default_factory=list)
    artifacts: list[ArtifactSummary] = Field(default_factory=list)

    model_config = {"frozen": True}


class TraceSummary(BaseModel):
    """Row in the `observatory.query_traces` result list (spec § 7.1).

    Deliberately trace_id-addressable so the Lead Agent can answer
    'how many runs did writer do last week' and hand back clickable ids.

    ``tokens`` carries the per-run input / output / total split; the legacy
    single-int field stays available via ``tokens.total`` for callers that
    only care about a headline number.
    """

    trace_id: str
    employee_id: str | None = None
    employee_name: str | None = None
    model_ref: str | None = None
    status: str = "ok"  # "ok" | "failed" | "running"
    duration_s: float | None = None
    tokens: RunTokenUsage = Field(default_factory=RunTokenUsage)
    llm_calls: int = 0
    started_at: datetime

    model_config = {"frozen": True}


__all__ = [
    "ArtifactSummary",
    "ObservabilityConfig",
    "ObservatoryEmployeeBreakdown",
    "ObservatoryErrorBreakdown",
    "ObservatoryModelBreakdown",
    "ObservatorySummary",
    "ObservatoryToolBreakdown",
    "RunDetail",
    "RunError",
    "RunStatus",
    "RunTokenUsage",
    "TimeSeries",
    "TimeSeriesPoint",
    "TraceSummary",
    "Turn",
    "TurnLLMCall",
    "TurnMessage",
    "TurnThinking",
    "TurnToolCall",
    "TurnUserInput",
]
