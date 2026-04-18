"""Chat and conversation endpoints."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from allhands.api.deps import (
    get_chat_service,
    get_conversation_repo,
    get_employee_service,
    get_session,
)
from allhands.api.protocol import (
    ConversationResponse,
    CreateConversationRequest,
    SendMessageRequest,
)
from allhands.core.errors import DomainError, EmployeeNotFound

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/conversations", tags=["chat"])


@router.post("", response_model=ConversationResponse)
async def create_conversation(
    body: CreateConversationRequest,
    session: AsyncSession = Depends(get_session),
) -> ConversationResponse:
    emp_svc = await get_employee_service(session)
    chat_svc = await get_chat_service(session)
    try:
        await emp_svc.get(body.employee_id)
    except EmployeeNotFound as exc:
        raise HTTPException(
            status_code=404, detail=f"Employee {body.employee_id!r} not found."
        ) from exc
    conv = await chat_svc.create_conversation(body.employee_id)
    return ConversationResponse(
        id=conv.id,
        employee_id=conv.employee_id,
        title=conv.title,
        created_at=conv.created_at.isoformat(),
    )


@router.get("")
async def list_conversations(
    employee_id: str | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[ConversationResponse]:
    """List conversations.

    - `?employee_id=<id>` filters to that employee's conversations.
    - no param → default to Lead Agent's conversations (legacy behaviour).
    - `?employee_id=all` → across every employee, newest first.
    """
    conv_repo = await get_conversation_repo(session)
    emp_svc = await get_employee_service(session)
    if employee_id == "all":
        convs = await conv_repo.list_all()
    elif employee_id:
        try:
            await emp_svc.get(employee_id)
        except EmployeeNotFound as exc:
            raise HTTPException(
                status_code=404, detail=f"Employee {employee_id!r} not found."
            ) from exc
        convs = await conv_repo.list_for_employee(employee_id)
    else:
        lead = await emp_svc.get_lead()
        if lead is None:
            return []
        convs = await conv_repo.list_for_employee(lead.id)
    return [
        ConversationResponse(
            id=c.id,
            employee_id=c.employee_id,
            title=c.title,
            created_at=c.created_at.isoformat(),
        )
        for c in convs
    ]


@router.post("/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    body: SendMessageRequest,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    chat_svc = await get_chat_service(session)

    async def event_stream() -> AsyncIterator[str]:
        try:
            stream = await chat_svc.send_message(conversation_id, body.content)
            async for event in stream:
                data = event.model_dump(mode="json")
                yield f"event: {event.kind}\ndata: {json.dumps(data)}\n\n"
        except DomainError as exc:
            yield f"event: error\ndata: {json.dumps({'code': 'DOMAIN_ERROR', 'message': str(exc)})}\n\n"
        except Exception as exc:
            yield f"event: error\ndata: {json.dumps({'code': 'INTERNAL', 'message': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
