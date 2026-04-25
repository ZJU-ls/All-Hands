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

if TYPE_CHECKING:
    from allhands.services.observatory_service import ObservatoryService


router = APIRouter(prefix="/observatory", tags=["observatory"])


@router.get("/summary")
async def get_summary(
    svc: ObservatoryService = Depends(get_observatory_service),
) -> dict[str, object]:
    summary = await svc.get_summary()
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


@router.get("/traces")
async def list_traces(
    svc: ObservatoryService = Depends(get_observatory_service),
    employee_id: str | None = Query(default=None),
    status: str | None = Query(default=None, pattern="^(ok|failed|running)$"),
    since: datetime | None = Query(default=None),
    until: datetime | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
) -> dict[str, object]:
    traces = await svc.list_traces(
        employee_id=employee_id,
        status=status,
        since=since,
        until=until,
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
        raise HTTPException(status_code=404, detail=f"trace not found: {trace_id}")
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
        raise HTTPException(status_code=404, detail=f"run not found: {run_id}")
    return detail.model_dump(mode="json")
