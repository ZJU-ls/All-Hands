"""ObservatoryService — summary + trace listing + bootstrap orchestration.

Spec `docs/specs/agent-design/2026-04-18-observatory.md` § 5 - § 8.

v0 MVP scope (delivered this wave):
- `get_summary()` aggregates `events` + `observability_config` into an
  `ObservatorySummary` so `/observatory` and `observatory.get_status` return
  consistent numbers.
- `list_traces(filter)` / `get_trace(id)` read from the local `events` table
  filtered on `run.*` kinds. Once the Langfuse HTTP API client lands the
  implementation swaps over without touching callers.
- `get_status()` / `bootstrap_now()` expose the singleton
  `observability_config` row.

Deferred to a follow-up (Langfuse wave 2):
- 8-step Langfuse bootstrap orchestration (spec § 5.1)
- CallbackHandler hot-reload (spec § 5.4)
- iframe session proxy (spec § 6.3)
- AES-256-GCM wrapping of `secret_key` / `admin_password`

This is the L01 shared implementation — both `api/routers/observatory.py`
and the 4 Meta Tools in `execution/tools/meta/observatory_tools.py` delegate
here so REST and Lead Agent can never drift.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from allhands.core import (
    BootstrapStatus,
    ObservabilityConfig,
    ObservatoryEmployeeBreakdown,
    ObservatorySummary,
    TraceSummary,
)

if TYPE_CHECKING:
    from allhands.persistence.repositories import (
        EmployeeRepo,
        EventRepo,
        ObservabilityConfigRepo,
    )


_RUN_KINDS = ("run.",)
_RUN_FAILED_KINDS = ("run.failed",)


class ObservatoryService:
    """Shared service behind REST + 4 Meta Tools (L01 Tool First parity).

    All state comes from three repos; no Langfuse HTTP calls yet — the
    trace views derive from the local `events` table so the page has real
    numbers on day 1 even before Langfuse is reachable.
    """

    def __init__(
        self,
        *,
        event_repo: EventRepo,
        employee_repo: EmployeeRepo,
        config_repo: ObservabilityConfigRepo,
        workspace_id: str = "default",
    ) -> None:
        self._events = event_repo
        self._employees = employee_repo
        self._config = config_repo
        self._ws = workspace_id

    async def get_status(self) -> ObservabilityConfig:
        return await self._config.load()

    async def get_summary(self, *, now: datetime | None = None) -> ObservatorySummary:
        ts_now = now or datetime.now(UTC)
        day_start = ts_now - timedelta(hours=24)

        cfg = await self._config.load()

        runs_total = await self._events.count_since(
            since=datetime.fromtimestamp(0, tz=UTC),
            workspace_id=self._ws,
            kind_prefixes=list(_RUN_KINDS),
        )
        runs_24h = await self._events.count_since(
            since=day_start,
            workspace_id=self._ws,
            kind_prefixes=list(_RUN_KINDS),
        )
        failed_24h = await self._events.count_since(
            since=day_start,
            workspace_id=self._ws,
            kind_prefixes=list(_RUN_FAILED_KINDS),
        )

        failure_rate = (failed_24h / runs_24h) if runs_24h else 0.0

        recent = await self._events.list_recent(
            limit=1000,
            workspace_id=self._ws,
            kind_prefixes=list(_RUN_KINDS),
            since=day_start,
        )
        durations = [
            float(e.payload["duration_s"])
            for e in recent
            if isinstance(e.payload.get("duration_s"), (int, float))
        ]
        p50 = _percentile(durations, 0.5) if durations else 0.0

        tokens = [
            int(e.payload["tokens"]) for e in recent if isinstance(e.payload.get("tokens"), int)
        ]
        avg_tokens = int(sum(tokens) / len(tokens)) if tokens else 0

        employees = await self._employees.list_all()
        name_by_id = {e.id: e.name for e in employees}
        by_emp_counts: dict[str, int] = {}
        for e in recent:
            emp_id = e.payload.get("employee_id") or e.actor
            if isinstance(emp_id, str):
                by_emp_counts[emp_id] = by_emp_counts.get(emp_id, 0) + 1
        by_employee = [
            ObservatoryEmployeeBreakdown(
                employee_id=eid,
                employee_name=name_by_id.get(eid, eid),
                runs_count=count,
            )
            for eid, count in sorted(by_emp_counts.items(), key=lambda kv: -kv[1])
        ]

        return ObservatorySummary(
            traces_total=runs_total,
            failure_rate_24h=round(failure_rate, 4),
            latency_p50_s=round(p50, 3),
            avg_tokens_per_run=avg_tokens,
            by_employee=by_employee,
            observability_enabled=cfg.observability_enabled,
            bootstrap_status=cfg.bootstrap_status,
            bootstrap_error=cfg.bootstrap_error,
            host=cfg.host,
        )

    async def list_traces(
        self,
        *,
        employee_id: str | None = None,
        status: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int = 50,
    ) -> list[TraceSummary]:
        events = await self._events.list_recent(
            limit=max(limit * 4, limit),
            workspace_id=self._ws,
            kind_prefixes=list(_RUN_KINDS),
            since=since,
        )
        employees = await self._employees.list_all()
        name_by_id = {e.id: e.name for e in employees}

        out: list[TraceSummary] = []
        for e in events:
            if until is not None and e.published_at > until:
                continue
            eid = e.payload.get("employee_id") or e.actor
            if employee_id and eid != employee_id:
                continue
            trace_status = "failed" if e.kind.endswith(".failed") else "ok"
            if status and trace_status != status:
                continue
            trace_id_raw = e.payload.get("trace_id") or e.id
            trace_id = str(trace_id_raw)
            duration = e.payload.get("duration_s")
            tokens = e.payload.get("tokens")
            out.append(
                TraceSummary(
                    trace_id=trace_id,
                    employee_id=eid if isinstance(eid, str) else None,
                    employee_name=name_by_id.get(eid) if isinstance(eid, str) else None,
                    status=trace_status,
                    duration_s=float(duration) if isinstance(duration, (int, float)) else None,
                    tokens=int(tokens) if isinstance(tokens, int) else 0,
                    started_at=e.published_at,
                )
            )
            if len(out) >= limit:
                break
        return out

    async def get_trace(self, trace_id: str) -> TraceSummary | None:
        traces = await self.list_traces(limit=500)
        for t in traces:
            if t.trace_id == trace_id:
                return t
        return None

    async def bootstrap_now(self) -> ObservabilityConfig:
        """Idempotent status refresh (spec § 7 BOOTSTRAP semantics).

        v0 MVP: returns current config without touching Langfuse. When the
        8-step bootstrap service lands it replaces this body; the tool +
        REST contract stays identical because both call through this method.
        """
        return await self._config.load()


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    idx = int(len(s) * pct)
    if idx >= len(s):
        idx = len(s) - 1
    return s[idx]


__all__ = [
    "BootstrapStatus",
    "ObservatoryService",
]
