"""Observatory router — summary, status, trace listing.

Self-instrumented · sources are local events. Langfuse + the embedded
bootstrap flow were removed in 2026-04-25.

Shares `ObservatoryService` with `execution/tools/meta/observatory_tools.py`
so REST (UI path) and Meta Tools (Lead Agent path) can never drift.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from allhands.api.deps import get_observatory_service
from allhands.i18n import t

if TYPE_CHECKING:
    from allhands.services.observatory_service import ObservatoryService


router = APIRouter(prefix="/observatory", tags=["observatory"])


@router.get("/summary")
async def get_summary(
    svc: ObservatoryService = Depends(get_observatory_service),
    hours: int = Query(default=24, ge=1, le=720),
    employee_id: str | None = Query(default=None),
    model_ref: str | None = Query(default=None),
) -> dict[str, object]:
    """Aggregated observatory summary for the last ``hours`` hours.

    Optional dimension filters scope the whole summary to one employee or
    model — used by the per-dimension detail pages
    (``/observatory/employees/[id]`` and ``/observatory/models/[ref]``).
    """
    summary = await svc.get_summary(
        window_hours=hours,
        employee_id=employee_id,
        model_ref=model_ref,
    )
    return summary.model_dump(mode="json")


@router.get("/status")
async def get_status(
    svc: ObservatoryService = Depends(get_observatory_service),
) -> dict[str, object]:
    """Self-instrumented telemetry health · always enabled.

    Returns the user-toggleable flags (currently ``auto_title_enabled``)
    plus a constant ``observability_enabled=True``. Pre-2026-04-25 this
    endpoint also surfaced langfuse bootstrap state; that is gone.
    """
    cfg = await svc.get_status()
    return {
        "observability_enabled": cfg.observability_enabled,
        "auto_title_enabled": cfg.auto_title_enabled,
    }


@router.patch("/config")
async def patch_config(
    payload: dict[str, object] = Body(...),
    svc: ObservatoryService = Depends(get_observatory_service),
) -> dict[str, object]:
    """Mutate user-toggleable system flags (currently `auto_title_enabled`)."""
    cfg = await svc.update_flags(
        auto_title_enabled=(
            bool(payload["auto_title_enabled"]) if "auto_title_enabled" in payload else None
        ),
    )
    return {
        "auto_title_enabled": cfg.auto_title_enabled,
        "observability_enabled": cfg.observability_enabled,
    }


_METRICS_PATTERN = (
    "^(runs|failure_rate|latency_p50|latency_p95|latency_p99|"
    "tokens_total|tokens_input|tokens_output|llm_calls|cost)$"
)


@router.get("/series")
async def get_series(
    svc: ObservatoryService = Depends(get_observatory_service),
    metric: str = Query(..., pattern=_METRICS_PATTERN),
    since: datetime | None = Query(default=None),
    until: datetime | None = Query(default=None),
    bucket: str = Query(default="1h", pattern="^(5m|1h)$"),
    employee_id: str | None = Query(default=None),
    model_ref: str | None = Query(default=None),
) -> dict[str, object]:
    """Bucketed time-series for one observatory metric.

    Drives the KPI-card / stat-row drilldown chart on the observatory page —
    the user clicks a metric and we show the consumption curve over the
    selected time window. Optional ``employee_id`` / ``model_ref`` scope
    the series so the detail pages can show per-dimension trends.
    """
    series = await svc.get_series(
        metric=metric,
        since=since,
        until=until,
        bucket=bucket,
        employee_id=employee_id,
        model_ref=model_ref,
    )
    return series.model_dump(mode="json")


@router.get("/traces")
async def list_traces(
    svc: ObservatoryService = Depends(get_observatory_service),
    employee_id: str | None = Query(default=None),
    model_ref: str | None = Query(default=None),
    status: str | None = Query(default=None, pattern="^(ok|failed|running)$"),
    since: datetime | None = Query(default=None),
    until: datetime | None = Query(default=None),
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=500),
) -> dict[str, object]:
    traces = await svc.list_traces(
        employee_id=employee_id,
        model_ref=model_ref,
        status=status,
        since=since,
        until=until,
        q=q,
        limit=limit,
    )
    return {
        "traces": [t.model_dump(mode="json") for t in traces],
        "count": len(traces),
    }


@router.get("/traces/{trace_id}")
async def get_trace(
    trace_id: str,
    svc: ObservatoryService = Depends(get_observatory_service),
) -> dict[str, object]:
    trace = await svc.get_trace(trace_id)
    if trace is None:
        raise HTTPException(status_code=404, detail=t("errors.not_found.trace_id", id=trace_id))
    return trace.model_dump(mode="json")


@router.get("/runs/{run_id}")
async def get_run_detail(
    run_id: str,
    svc: ObservatoryService = Depends(get_observatory_service),
) -> dict[str, object]:
    """Full trace for a single run (spec 2026-04-21 §4.1).

    Drives the hybrid trace viewer: the RunTraceDrawer (list-page overlay),
    ``/runs/[id]`` standalone page, and inline blocks on ``/tasks/[id]``
    all fetch this payload.
    """
    detail = await svc.get_run_detail(run_id)
    if detail is None:
        raise HTTPException(status_code=404, detail=t("errors.not_found.run_id", id=run_id))
    return detail.model_dump(mode="json")
