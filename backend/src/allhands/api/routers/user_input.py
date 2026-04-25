"""ADR 0019 C3 · clarification answer endpoint.

Mirrors the confirmations resolve flow: the frontend dialog POSTs
{answers: {label: choice}} when the user submits, this flips the row to
ANSWERED, and the polling UserInputDeferred unblocks the suspended
agent loop on its next tick.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException

from allhands.api.deps import get_session
from allhands.core import UserInputStatus
from allhands.i18n import t
from allhands.persistence.sql_repos import SqlUserInputRepo

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/user-input", tags=["user-input"])


@router.get("/pending")
async def list_pending_user_inputs(
    session: AsyncSession = Depends(get_session),
) -> list[dict[str, Any]]:
    repo = SqlUserInputRepo(session)
    rows = await repo.list_pending()
    return [
        {
            "id": ui.id,
            "tool_call_id": ui.tool_call_id,
            "questions": [q.model_dump(mode="json") for q in ui.questions],
            "status": ui.status.value,
            "created_at": ui.created_at.isoformat(),
            "expires_at": ui.expires_at.isoformat(),
        }
        for ui in rows
    ]


@router.post("/{ui_id}/answer")
async def answer_user_input(
    ui_id: str,
    body: dict[str, Any],
    session: AsyncSession = Depends(get_session),
) -> dict[str, bool]:
    answers_raw = body.get("answers")
    if not isinstance(answers_raw, dict):
        raise HTTPException(status_code=400, detail=t("errors.answers_not_dict"))
    answers = {str(k): str(v) for k, v in answers_raw.items()}
    repo = SqlUserInputRepo(session)
    row = await repo.get(ui_id)
    if row is None:
        raise HTTPException(status_code=404, detail=t("errors.not_found.user_input"))
    if row.status != UserInputStatus.PENDING:
        raise HTTPException(status_code=409, detail=t("errors.user_input_not_pending"))
    await repo.update_status_with_answers(ui_id, UserInputStatus.ANSWERED, answers)
    return {"ok": True}
