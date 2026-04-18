"""Cockpit router — workspace-level read + global pause switch.

Spec `docs/specs/agent-design/2026-04-18-cockpit.md` § 4.

- `GET /api/cockpit/summary` — one-shot `WorkspaceSummary` snapshot.
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

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from allhands.api.deps import get_cockpit_service, get_pause_switch

if TYPE_CHECKING:
    from allhands.services.cockpit_service import CockpitService
    from allhands.services.pause_state import PauseSwitch

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
