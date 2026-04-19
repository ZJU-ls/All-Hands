"""Cockpit router — workspace-level read + global pause switch + SSE stream.

Spec `docs/specs/agent-design/2026-04-18-cockpit.md` § 4.

- `GET /api/cockpit/summary` — one-shot `WorkspaceSummary` snapshot.
- `GET /api/cockpit/stream` — workspace-level SSE. First frame is a `snapshot`
  event, then incremental `activity`/`run_update`/`run_done`/`health`/`kpi`
  events from the in-memory EventBus, plus a 15s `heartbeat`. One stream per
  open cockpit tab; the trigger runtime owns the bus singleton.
- `POST /api/cockpit/pause-all` — emergency brake. Requires an
  `X-Confirmation-Token` header (any non-empty value) so a stray click in the
  UI cannot trigger it without an explicit confirm step. The UI flow is: first
  click → modal → modal calls this endpoint with a token.
- `POST /api/cockpit/resume-all` — symmetric; no confirmation needed.

Pause state is process-local (see `services/pause_state.PauseSwitch`). A single
instance is shared via `Depends(get_pause_switch)`; tests can override that
dependency to inject a fresh switch per case.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from allhands.api.deps import get_cockpit_service, get_pause_switch

if TYPE_CHECKING:
    from allhands.core import EventEnvelope
    from allhands.execution.event_bus import EventBus
    from allhands.services.cockpit_service import CockpitService
    from allhands.services.pause_state import PauseSwitch

logger = logging.getLogger(__name__)

# Cockpit stream tuning. Heartbeat cadence matches the spec §4.2; client marks
# the connection stale when it goes > 45s without seeing one (3x heartbeat).
_HEARTBEAT_SECONDS = 15.0
# Event-kind → SSE event name. Unknown kinds fall through as raw `activity` so
# the event still reaches the feed; the client tolerates the generic label.
_KIND_TO_SSE_EVENT = {
    "run.started": "run_update",
    "run.updated": "run_update",
    "run.finished": "run_done",
    "run.cancelled": "run_done",
    "health.updated": "health",
    "kpi.updated": "kpi",
}

router = APIRouter(prefix="/cockpit", tags=["cockpit"])


class PauseRequest(BaseModel):
    reason: str | None = None


class PauseResponse(BaseModel):
    paused: bool
    reason: str | None
    paused_at: str | None
    already_paused: bool = False


@router.get("/summary")
async def get_summary(
    svc: CockpitService = Depends(get_cockpit_service),
) -> dict[str, object]:
    summary = await svc.build_summary()
    return summary.model_dump(mode="json")


def _sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@router.get("/stream")
async def stream(
    request: Request,
    svc: CockpitService = Depends(get_cockpit_service),
) -> StreamingResponse:
    """Workspace-level SSE. First frame is a `snapshot`; then bus events +
    heartbeats. Client reconnects with exp-backoff; each reconnect re-sends a
    fresh snapshot so the UI self-heals without the server tracking resume
    tokens.
    """
    # Bus is owned by TriggerRuntime (started in app lifespan). If runtime
    # failed to start we still deliver the opening snapshot + heartbeats; the
    # page stays useful even without incremental events.
    runtime = getattr(request.app.state, "trigger_runtime", None)
    bus: EventBus | None = getattr(runtime, "bus", None) if runtime is not None else None

    queue: asyncio.Queue[tuple[str, object]] = asyncio.Queue()
    unsubscribe = None

    if bus is not None:

        async def _on_event(env: EventEnvelope) -> None:
            sse_event = _KIND_TO_SSE_EVENT.get(env.kind, "activity")
            payload = {
                "id": env.id,
                "kind": env.kind,
                "ts": env.published_at.isoformat(),
                "payload": env.payload,
            }
            await queue.put((sse_event, payload))

        unsubscribe = bus.subscribe_all(_on_event)

    async def event_stream() -> AsyncIterator[str]:
        try:
            snapshot = await svc.build_summary()
            yield _sse("snapshot", snapshot.model_dump(mode="json"))

            while True:
                if await request.is_disconnected():
                    return
                try:
                    sse_event, payload = await asyncio.wait_for(
                        queue.get(), timeout=_HEARTBEAT_SECONDS
                    )
                    yield _sse(sse_event, payload)
                except TimeoutError:
                    yield _sse("heartbeat", {"ts": datetime.now(UTC).isoformat()})
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("cockpit.stream.failed")
            yield _sse(
                "error",
                {"code": "INTERNAL", "message": "cockpit stream terminated"},
            )
        finally:
            if unsubscribe is not None:
                unsubscribe()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/pause-all", response_model=PauseResponse)
async def pause_all(
    body: PauseRequest,
    switch: PauseSwitch = Depends(get_pause_switch),
    x_confirmation_token: str | None = Header(default=None),
) -> PauseResponse:
    if not x_confirmation_token:
        raise HTTPException(
            status_code=412,
            detail=(
                "X-Confirmation-Token header required. pause-all is an "
                "IRREVERSIBLE action; confirm in the UI modal first."
            ),
        )
    was_paused = switch.snapshot().paused
    state = switch.pause(reason=body.reason)
    return PauseResponse(
        paused=state.paused,
        reason=state.reason,
        paused_at=state.paused_at.isoformat() if state.paused_at else None,
        already_paused=was_paused,
    )


@router.post("/resume-all", response_model=PauseResponse)
async def resume_all(
    switch: PauseSwitch = Depends(get_pause_switch),
) -> PauseResponse:
    state = switch.resume()
    return PauseResponse(
        paused=state.paused,
        reason=state.reason,
        paused_at=state.paused_at.isoformat() if state.paused_at else None,
    )
