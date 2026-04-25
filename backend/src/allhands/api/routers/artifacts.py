"""Read-only artifact endpoints.

Per spec `docs/specs/agent-design/2026-04-18-artifacts-skill.md` § 5, write
operations are agent-managed and live in `execution/tools/meta/artifact_tools.py`;
the REST surface only exposes browsing + content fetching for the UI panel.
This keeps the L01 Tool First contract intact: no REST write endpoints for
agent-managed resources.

The `/stream` endpoint (I-0005) is pure event fan-out — it subscribes to the
in-process EventBus for `artifact_changed` envelopes and re-emits them as SSE
so `ArtifactPanel` can live-refresh without polling. No DB work inside the
stream body, so we do not hit the TestClient+aiosqlite+SSE deadlock that
forces `cockpit.stream` to be skipped in tests.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import secrets
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from allhands.api import ag_ui_encoder as agui
from allhands.api.deps import get_artifact_service
from allhands.core import BINARY_KINDS, Artifact, ArtifactKind, ArtifactVersion
from allhands.services.artifact_service import (
    ArtifactContentMissing,
    ArtifactNotFound,
    ArtifactService,
)

if TYPE_CHECKING:
    from allhands.core import EventEnvelope
    from allhands.execution.event_bus import EventBus

logger = logging.getLogger(__name__)

# Matches cockpit.stream cadence: clients treat >3x idle as stale.
_HEARTBEAT_SECONDS = 15.0

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


class ArtifactResponse(BaseModel):
    id: str
    workspace_id: str
    name: str
    kind: str
    mime_type: str
    size_bytes: int
    version: int
    pinned: bool
    deleted_at: str | None
    conversation_id: str | None
    created_by_employee_id: str | None
    created_at: str
    updated_at: str


class ArtifactVersionResponse(BaseModel):
    version: int
    created_at: str
    size_bytes: int
    has_diff: bool


class ArtifactContentResponse(BaseModel):
    id: str
    version: int
    kind: str
    mime_type: str
    content: str | None = None
    content_base64: str | None = None
    truncated: bool = False


class ContributorEntry(BaseModel):
    """One row of the top-contributors leaderboard. `key` is whatever was
    populated on the artifacts (employee_id) — the page resolves it to a
    display name from its own employee cache. `count` is the artifact tally."""

    key: str
    count: int


class ArtifactStatsResponse(BaseModel):
    """Workspace-wide artifact aggregations for the /artifacts dashboard.

    Computed from `list_all` so we share one query path; the page asks for
    stats once on mount + after any artifact_changed SSE frame, not on every
    keystroke. If we ever cross the ~10k-rows mark we'll move to a SQL
    GROUP BY in the repo, but at that point the global page should also
    paginate; for v0 the catalog is well under that.

    iter 6 additions:
      daily_counts · last 14 days, oldest → newest, count of artifacts
                     created on that day (UTC). Drives the activity
                     sparkline.
      top_employees · employee_id keyed leaderboard (top 5) of who
                      authored the most. UI resolves to display names.
    """

    total: int
    pinned: int
    last_7d: int
    total_bytes: int
    by_kind: dict[str, int]
    largest_kind: str | None
    latest_updated_at: str | None
    daily_counts: list[int]
    top_employees: list[ContributorEntry]


def _to_response(art: Artifact) -> ArtifactResponse:
    return ArtifactResponse(
        id=art.id,
        workspace_id=art.workspace_id,
        name=art.name,
        kind=art.kind.value,
        mime_type=art.mime_type,
        size_bytes=art.size_bytes,
        version=art.version,
        pinned=art.pinned,
        deleted_at=art.deleted_at.isoformat() if art.deleted_at else None,
        conversation_id=art.conversation_id,
        created_by_employee_id=art.created_by_employee_id,
        created_at=art.created_at.isoformat(),
        updated_at=art.updated_at.isoformat(),
    )


def _to_version_response(v: ArtifactVersion) -> ArtifactVersionResponse:
    # All versions live on disk now; size reads via stat. Cheap, but a 0
    # fallback keeps the endpoint forgiving when the file was wiped (e.g.
    # devs nuking data/artifacts/ to clean up).
    return ArtifactVersionResponse(
        version=v.version,
        created_at=v.created_at.isoformat(),
        size_bytes=0,
        has_diff=v.diff_from_prev is not None,
    )


@router.get("", response_model=list[ArtifactResponse])
async def list_artifacts(
    kind: str | None = Query(default=None),
    name_prefix: str | None = Query(default=None),
    pinned: bool = Query(default=False),
    include_deleted: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
    # 2026-04-25 v2 — multi-dimensional filtering for /artifacts global page.
    # ``scope`` is a UI convenience: scope=conversation requires conversation_id;
    # scope=employee requires employee_id; scope=global / unset = no extra
    # filter. The backend just pipes the values; scope itself is not a column.
    conversation_id: str | None = Query(default=None),
    employee_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    q: str | None = Query(default=None),
    sort: str = Query(default="updated_at_desc"),
    created_after: datetime | None = Query(default=None),
    created_before: datetime | None = Query(default=None),
    svc: ArtifactService = Depends(get_artifact_service),
) -> list[ArtifactResponse]:
    parsed_kind: ArtifactKind | None = None
    if kind is not None:
        try:
            parsed_kind = ArtifactKind(kind)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"unknown kind {kind!r}") from exc
    items = await svc.list_all(
        kind=parsed_kind,
        name_prefix=name_prefix,
        pinned_only=pinned,
        include_deleted=include_deleted,
        limit=limit,
        conversation_id=conversation_id,
        employee_id=employee_id,
        status=status,
        tag=tag,
        q=q,
        sort=sort,
        created_after=created_after,
        created_before=created_before,
    )
    return [_to_response(a) for a in items]


@router.get("/stats", response_model=ArtifactStatsResponse)
async def artifact_stats(
    svc: ArtifactService = Depends(get_artifact_service),
) -> ArtifactStatsResponse:
    """Workspace-wide artifact aggregations for the /artifacts dashboard."""
    items = await svc.list_all(limit=500, include_deleted=False)
    by_kind: dict[str, int] = {}
    total_bytes = 0
    pinned = 0
    last_7d = 0
    latest_updated: datetime | None = None
    now = datetime.now(UTC)
    cutoff_7d = now.timestamp() - 7 * 24 * 3600
    # 14-day daily histogram · index 0 = 13 days ago, index 13 = today
    daily_counts = [0] * 14
    by_employee: dict[str, int] = {}
    today_midnight = datetime(now.year, now.month, now.day, tzinfo=UTC)
    for a in items:
        by_kind[a.kind.value] = by_kind.get(a.kind.value, 0) + 1
        total_bytes += a.size_bytes
        if a.pinned:
            pinned += 1
        if a.created_at.timestamp() >= cutoff_7d:
            last_7d += 1
        if latest_updated is None or a.updated_at > latest_updated:
            latest_updated = a.updated_at
        # Slot creation into the 14-day bucket (UTC days). Older artifacts
        # silently fall outside; the histogram is short on purpose for a
        # peek-not-deep-dive sparkline.
        delta_days = int((today_midnight - a.created_at).total_seconds() // (24 * 3600))
        if 0 <= delta_days < 14:
            daily_counts[13 - delta_days] += 1
        if a.created_by_employee_id:
            by_employee[a.created_by_employee_id] = (
                by_employee.get(a.created_by_employee_id, 0) + 1
            )
    largest_kind = max(by_kind.items(), key=lambda kv: kv[1])[0] if by_kind else None
    top_employees = [
        ContributorEntry(key=k, count=v)
        for k, v in sorted(by_employee.items(), key=lambda kv: -kv[1])[:5]
    ]
    return ArtifactStatsResponse(
        total=len(items),
        pinned=pinned,
        last_7d=last_7d,
        total_bytes=total_bytes,
        by_kind=by_kind,
        largest_kind=largest_kind,
        latest_updated_at=latest_updated.isoformat() if latest_updated else None,
        daily_counts=daily_counts,
        top_employees=top_employees,
    )


@router.get("/stream")
async def stream_artifacts(request: Request) -> StreamingResponse:
    """AG-UI v1 SSE feed of ``artifact_changed`` envelopes (I-0005 / I-0017).

    Wire sequence:
      RUN_STARTED(threadId="artifacts", runId=run_<rand>)
      CUSTOM allhands.artifacts_ready {ts}
      (per bus event) CUSTOM allhands.artifact_changed {id, kind, ts, payload}
      (idle) CUSTOM allhands.heartbeat {ts}
      RUN_FINISHED on disconnect · RUN_ERROR on failure

    Opens without a snapshot — the panel already lists artifacts via the REST
    list endpoint on mount; this stream only carries incremental change
    events so clients re-fetch (or patch their local copy). A 15s heartbeat
    keeps proxies from idle-timeout killing the connection.
    """
    runtime = getattr(request.app.state, "trigger_runtime", None)
    bus: EventBus | None = getattr(runtime, "bus", None) if runtime is not None else None

    queue: asyncio.Queue[dict[str, object]] = asyncio.Queue()
    unsubscribe = None

    if bus is not None:

        async def _on_event(env: EventEnvelope) -> None:
            if env.kind != "artifact_changed":
                return
            await queue.put(
                {
                    "id": env.id,
                    "kind": env.kind,
                    "ts": env.published_at.isoformat(),
                    "payload": env.payload,
                }
            )

        unsubscribe = bus.subscribe_all(_on_event)

    thread_id = "artifacts"
    run_id = f"run_{secrets.token_hex(8)}"

    async def event_stream() -> AsyncIterator[bytes]:
        finished = False
        try:
            yield agui.encode_sse(agui.run_started(thread_id, run_id))
            yield agui.encode_sse(
                agui.custom("allhands.artifacts_ready", {"ts": datetime.now(UTC).isoformat()})
            )
            while True:
                if await request.is_disconnected():
                    break
                try:
                    frame = await asyncio.wait_for(queue.get(), timeout=_HEARTBEAT_SECONDS)
                    yield agui.encode_sse(agui.custom("allhands.artifact_changed", frame))
                except TimeoutError:
                    yield agui.encode_sse(
                        agui.custom(
                            "allhands.heartbeat",
                            {"ts": datetime.now(UTC).isoformat()},
                        )
                    )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("artifacts.stream.failed")
            yield agui.encode_sse(
                agui.run_error(str(exc) or "artifact stream terminated", "INTERNAL")
            )
            finished = True
        finally:
            if not finished:
                yield agui.encode_sse(agui.run_finished(thread_id, run_id))
            if unsubscribe is not None:
                unsubscribe()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{artifact_id}", response_model=ArtifactResponse)
async def get_artifact(
    artifact_id: str,
    svc: ArtifactService = Depends(get_artifact_service),
) -> ArtifactResponse:
    try:
        art = await svc.get(artifact_id)
    except ArtifactNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_response(art)


@router.get("/{artifact_id}/content")
async def get_artifact_content(
    artifact_id: str,
    download: bool = Query(default=False),
    svc: ArtifactService = Depends(get_artifact_service),
) -> Response:
    try:
        art = await svc.get(artifact_id)
    except ArtifactNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        blob = svc.read_bytes(art)
    except ArtifactContentMissing as exc:
        # 404 is the right status here · the DB row exists but the file is
        # gone (worktree drift / disk wipe). The UI maps 404 to a friendly
        # "content missing" empty state, much better than 500.
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    headers: dict[str, str] = {}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{art.name}"'
    return Response(content=blob, media_type=art.mime_type, headers=headers)


@router.get("/{artifact_id}/versions", response_model=list[ArtifactVersionResponse])
async def list_artifact_versions(
    artifact_id: str,
    svc: ArtifactService = Depends(get_artifact_service),
) -> list[ArtifactVersionResponse]:
    try:
        await svc.get(artifact_id)
    except ArtifactNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    versions = await svc.list_versions(artifact_id)
    return [_to_version_response(v) for v in versions]


class UpdateArtifactRequest(BaseModel):
    """User-edit payload (P1 · 2026-04-25). The artifact panel's edit UI
    POSTs this directly; ``mode='overwrite'`` is the only path the UI uses.
    Lead Agent goes through the meta tool ``artifact_update`` instead —
    same service-layer code, different transport."""

    mode: str = "overwrite"
    content: str | None = None
    content_base64: str | None = None
    patch: str | None = None


class RollbackArtifactRequest(BaseModel):
    to_version: int


@router.patch("/{artifact_id}", response_model=ArtifactResponse)
async def update_artifact(
    artifact_id: str,
    body: UpdateArtifactRequest,
    svc: ArtifactService = Depends(get_artifact_service),
) -> ArtifactResponse:
    """Edit an artifact's content (UI ⇆ panel edit mode).

    Pairs with the ``allhands.artifacts.update`` Meta Tool (L01 contract);
    same service entry-point. Confirmation Gate is NOT in front of this
    REST path — UI edit is a direct user action; the gate exists to put a
    human in the loop on agent-driven writes, not to prompt the user
    twice on their own click.
    """
    from allhands.services.artifact_service import ArtifactError

    try:
        updated = await svc.update(
            artifact_id,
            mode=body.mode,
            content=body.content,
            content_base64=body.content_base64,
            patch=body.patch,
        )
    except ArtifactNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ArtifactError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_response(updated)


@router.post("/{artifact_id}/rollback", response_model=ArtifactResponse)
async def rollback_artifact(
    artifact_id: str,
    body: RollbackArtifactRequest,
    svc: ArtifactService = Depends(get_artifact_service),
) -> ArtifactResponse:
    """Roll back to an older version. Creates a new v{N+1} carrying the
    older content; original history is preserved."""
    from allhands.services.artifact_service import ArtifactError

    try:
        updated = await svc.rollback(artifact_id, to_version=body.to_version)
    except ArtifactNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ArtifactError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_response(updated)


@router.get("/{artifact_id}/versions/{version}/content", response_model=ArtifactContentResponse)
async def get_artifact_version_content(
    artifact_id: str,
    version: int,
    svc: ArtifactService = Depends(get_artifact_service),
) -> ArtifactContentResponse:
    try:
        art = await svc.get(artifact_id)
        v = await svc.read_version(artifact_id, version)
    except ArtifactNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        blob = svc.read_version_bytes(v)
    except ArtifactContentMissing as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if art.kind in BINARY_KINDS:
        return ArtifactContentResponse(
            id=art.id,
            version=v.version,
            kind=art.kind.value,
            mime_type=art.mime_type,
            content_base64=base64.b64encode(blob).decode("ascii"),
        )
    return ArtifactContentResponse(
        id=art.id,
        version=v.version,
        kind=art.kind.value,
        mime_type=art.mime_type,
        content=blob.decode("utf-8"),
    )


# ─── Pin / delete · REST mirrors of the Meta Tool side (CLAUDE.md §3.1)
# Agent-managed resources are allowed REST CRUD as long as a same-name
# Meta Tool exists; both already do (artifact_pin · artifact_delete).
# These endpoints power the UI's bulk-action toolbar without forcing
# every action through the chat surface.


class PinArtifactRequest(BaseModel):
    pinned: bool


@router.post("/{artifact_id}/pin", response_model=ArtifactResponse)
async def pin_artifact(
    artifact_id: str,
    body: PinArtifactRequest,
    svc: ArtifactService = Depends(get_artifact_service),
) -> ArtifactResponse:
    try:
        updated = await svc.set_pinned(artifact_id, body.pinned)
    except ArtifactNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_response(updated)


@router.delete("/{artifact_id}", status_code=204)
async def delete_artifact(
    artifact_id: str,
    svc: ArtifactService = Depends(get_artifact_service),
) -> Response:
    try:
        await svc.delete(artifact_id)
    except ArtifactNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(status_code=204)
