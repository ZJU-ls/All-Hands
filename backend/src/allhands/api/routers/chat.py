"""Chat and conversation endpoints."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Request
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

log = logging.getLogger(__name__)

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


@router.get("/{conversation_id}", response_model=ConversationResponse)
async def get_conversation(
    conversation_id: str,
    session: AsyncSession = Depends(get_session),
) -> ConversationResponse:
    conv_repo = await get_conversation_repo(session)
    conv = await conv_repo.get(conversation_id)
    if conv is None:
        raise HTTPException(status_code=404, detail=f"Conversation {conversation_id!r} not found.")
    return ConversationResponse(
        id=conv.id,
        employee_id=conv.employee_id,
        title=conv.title,
        created_at=conv.created_at.isoformat(),
    )


@router.post("/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    body: SendMessageRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    """Stream an agent turn over SSE.

    I-0015 / I-0016: the client UI owns the "stop" button. When the user
    hits stop, it aborts the fetch which tears down the TCP connection;
    starlette surfaces that as a `http.disconnect` receive message. We
    poll `request.is_disconnected()` between events and break the loop so
    the underlying async generator (`runner.stream`) is closed and the
    LangGraph agent task is cancelled.
    """

    chat_svc = await get_chat_service(session)

    async def event_stream() -> AsyncIterator[str]:
        stream = None
        try:
            stream = await chat_svc.send_message(conversation_id, body.content)
            stream_iter = stream.__aiter__()
            while True:
                if await request.is_disconnected():
                    log.info(
                        "chat.send_message: client disconnected; cancelling agent stream",
                        extra={"conversation_id": conversation_id},
                    )
                    break
                try:
                    event = await stream_iter.__anext__()
                except StopAsyncIteration:
                    break
                data = event.model_dump(mode="json")
                yield f"event: {event.kind}\ndata: {json.dumps(data)}\n\n"
        except DomainError as exc:
            yield f"event: error\ndata: {json.dumps({'code': 'DOMAIN_ERROR', 'message': str(exc)})}\n\n"
        except asyncio.CancelledError:
            log.info(
                "chat.send_message: stream cancelled by runtime",
                extra={"conversation_id": conversation_id},
            )
            raise
        except Exception as exc:
            yield f"event: error\ndata: {json.dumps({'code': 'INTERNAL', 'message': str(exc)})}\n\n"
        finally:
            # Closing the async generator propagates GeneratorExit into the
            # agent loop, cancelling any in-flight LangGraph / LLM await.
            if stream is not None:
                aclose = getattr(stream, "aclose", None)
                if aclose is not None:
                    try:
                        await aclose()
                    except Exception:
                        log.debug(
                            "chat.send_message: aclose raised during cleanup",
                            exc_info=True,
                        )

    return StreamingResponse(event_stream(), media_type="text/event-stream")
