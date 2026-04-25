"""Confirmation resolution endpoints."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException

from allhands.api.deps import get_confirmation_service, get_session
from allhands.api.protocol import ConfirmationDecisionRequest, ConfirmationResponse
from allhands.i18n import t

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/confirmations", tags=["confirmations"])


@router.get("/pending", response_model=list[ConfirmationResponse])
async def list_pending_confirmations(
    session: AsyncSession = Depends(get_session),
) -> list[ConfirmationResponse]:
    svc = await get_confirmation_service(session)
    confirmations = await svc.list_pending()
    return [
        ConfirmationResponse(
            id=c.id,
            tool_call_id=c.tool_call_id,
            summary=c.summary,
            rationale=c.rationale,
            diff=c.diff,
            status=c.status.value,
            created_at=c.created_at.isoformat(),
            expires_at=c.expires_at.isoformat(),
        )
        for c in confirmations
    ]


@router.post("/{confirmation_id}/resolve", status_code=204)
async def resolve_confirmation(
    confirmation_id: str,
    body: ConfirmationDecisionRequest,
    session: AsyncSession = Depends(get_session),
) -> None:
    svc = await get_confirmation_service(session)
    conf = await svc.get(confirmation_id)
    if conf is None:
        raise HTTPException(status_code=404, detail=t("errors.not_found.confirmation"))
    if body.decision == "approve":
        await svc.approve(confirmation_id)
    else:
        await svc.reject(confirmation_id)
