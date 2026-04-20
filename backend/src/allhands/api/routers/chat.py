"""Chat and conversation endpoints."""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from allhands.api import ag_ui_encoder as agui
from allhands.api.deps import (
    get_chat_service,
    get_conversation_repo,
    get_employee_service,
    get_session,
)
from allhands.api.protocol import (
    ChatMessageResponse,
    CompactConversationRequest,
    CompactConversationResponse,
    ConversationResponse,
    CreateConversationRequest,
    SendMessageRequest,
    UpdateConversationRequest,
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
        model_ref_override=conv.model_ref_override,
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
            model_ref_override=c.model_ref_override,
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
        model_ref_override=conv.model_ref_override,
        created_at=conv.created_at.isoformat(),
    )


@router.patch("/{conversation_id}", response_model=ConversationResponse)
async def update_conversation(
    conversation_id: str,
    body: UpdateConversationRequest,
    session: AsyncSession = Depends(get_session),
) -> ConversationResponse:
    """Partial metadata update (Track ζ).

    The only mutable fields right now are ``title`` and the per-conversation
    ``model_ref_override``. Because Pydantic can't distinguish "omitted" from
    "null" on the default model, clients clear the override by sending
    ``{"clear_model_ref_override": true}`` rather than relying on null.
    """

    conv_repo = await get_conversation_repo(session)
    conv = await conv_repo.get(conversation_id)
    if conv is None:
        raise HTTPException(status_code=404, detail=f"Conversation {conversation_id!r} not found.")
    if body.title is not None:
        conv.title = body.title
    if body.clear_model_ref_override:
        conv.model_ref_override = None
    elif body.model_ref_override is not None:
        conv.model_ref_override = body.model_ref_override
    updated = await conv_repo.update(conv)
    return ConversationResponse(
        id=updated.id,
        employee_id=updated.employee_id,
        title=updated.title,
        model_ref_override=updated.model_ref_override,
        created_at=updated.created_at.isoformat(),
    )


@router.get("/{conversation_id}/messages", response_model=list[ChatMessageResponse])
async def list_messages(
    conversation_id: str,
    session: AsyncSession = Depends(get_session),
) -> list[ChatMessageResponse]:
    """History read — used by the UI to rehydrate a conversation on reload
    and by the usage chip to read the live message list after a compaction.
    """

    chat_svc = await get_chat_service(session)
    try:
        messages = await chat_svc.list_messages(conversation_id)
    except DomainError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return [
        ChatMessageResponse(
            id=m.id,
            conversation_id=m.conversation_id,
            role=m.role,
            content=m.content,
            created_at=m.created_at.isoformat(),
        )
        for m in messages
    ]


@router.post("/{conversation_id}/compact", response_model=CompactConversationResponse)
async def compact_conversation(
    conversation_id: str,
    body: CompactConversationRequest,
    session: AsyncSession = Depends(get_session),
) -> CompactConversationResponse:
    """Manual context compaction — keeps the last `keep_last` messages and
    replaces the older tail with a single synthetic system-role marker.

    Body shape `{"keep_last": 20}`; `keep_last` is clamped on the service side
    to its documented minimum. The response is the new message list so the
    frontend can swap its store in one assignment instead of reloading the
    whole page.
    """

    chat_svc = await get_chat_service(session)
    try:
        result = await chat_svc.compact_conversation(
            conversation_id,
            keep_last=body.keep_last if body.keep_last is not None else 20,
        )
    except DomainError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return CompactConversationResponse(
        dropped=result.dropped,
        summary_id=result.summary_id,
        messages=[
            ChatMessageResponse(
                id=m.id,
                conversation_id=m.conversation_id,
                role=m.role,
                content=m.content,
                created_at=m.created_at.isoformat(),
            )
            for m in result.messages
        ],
    )


@router.post("/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    body: SendMessageRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    """Stream an agent turn as AG-UI v1 SSE (I-0017 / ADR 0010).

    Wire sequence per turn:
      RUN_STARTED
        (per assistant message) TEXT_MESSAGE_START -> TEXT_MESSAGE_CONTENT * N -> TEXT_MESSAGE_END
        (per tool call) TOOL_CALL_START → TOOL_CALL_ARGS → TOOL_CALL_END → TOOL_CALL_RESULT
        (allhands-specific) CUSTOM with name ∈ {allhands.confirm_required,
          allhands.confirm_resolved, allhands.render, allhands.nested_run,
          allhands.trace}
        STEP_STARTED / STEP_FINISHED around nested runs
      RUN_FINISHED   (or RUN_ERROR on terminal failure)

    I-0015 / I-0016: the client UI owns the "stop" button. When the user
    hits stop, it aborts the fetch which tears down the TCP connection;
    starlette surfaces that as a ``http.disconnect`` receive message. We
    poll ``request.is_disconnected()`` between events and break the loop so
    the underlying async generator (``runner.stream``) is closed and the
    LangGraph agent task is cancelled.
    """

    chat_svc = await get_chat_service(session)

    async def event_stream() -> AsyncIterator[bytes]:
        run_id = f"run_{secrets.token_hex(8)}"
        yield agui.encode_sse(agui.run_started(conversation_id, run_id))

        stream = None
        current_message_id: str | None = None
        finished = False

        def _close_open_message() -> bytes | None:
            nonlocal current_message_id
            if current_message_id is None:
                return None
            closing = agui.encode_sse(agui.text_message_end(current_message_id))
            current_message_id = None
            return closing

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
                if event.kind == "token":
                    if current_message_id != event.message_id:
                        closing = _close_open_message()
                        if closing is not None:
                            yield closing
                        yield agui.encode_sse(agui.text_message_start(event.message_id))
                        current_message_id = event.message_id
                    yield agui.encode_sse(agui.text_message_content(event.message_id, event.delta))
                elif event.kind == "tool_call_start":
                    tc = event.tool_call
                    yield agui.encode_sse(agui.tool_call_start(tc.id, tc.tool_id))
                    if tc.args is not None:
                        yield agui.encode_sse(
                            agui.tool_call_args(tc.id, json.dumps(tc.args, ensure_ascii=False))
                        )
                elif event.kind == "tool_call_end":
                    tc = event.tool_call
                    yield agui.encode_sse(agui.tool_call_end(tc.id))
                    if tc.result is not None:
                        yield agui.encode_sse(
                            agui.tool_call_result(
                                tc.id,
                                json.dumps(tc.result, ensure_ascii=False, default=str),
                            )
                        )
                elif event.kind == "confirm_required":
                    payload = event.model_dump(mode="json", exclude={"kind"})
                    yield agui.encode_sse(agui.custom("allhands.confirm_required", payload))
                elif event.kind == "confirm_resolved":
                    payload = event.model_dump(mode="json", exclude={"kind"})
                    yield agui.encode_sse(agui.custom("allhands.confirm_resolved", payload))
                elif event.kind == "render":
                    payload = event.model_dump(mode="json", exclude={"kind"})
                    yield agui.encode_sse(agui.custom("allhands.render", payload))
                elif event.kind == "nested_run_start":
                    yield agui.encode_sse(agui.step_started(f"nested_run.{event.employee_name}"))
                    yield agui.encode_sse(
                        agui.custom(
                            "allhands.nested_run",
                            {
                                "run_id": event.run_id,
                                "parent_run_id": event.parent_run_id,
                                "employee_name": event.employee_name,
                                "phase": "start",
                            },
                        )
                    )
                elif event.kind == "nested_run_end":
                    yield agui.encode_sse(agui.step_finished(f"nested_run.{event.run_id}"))
                    yield agui.encode_sse(
                        agui.custom(
                            "allhands.nested_run",
                            {
                                "run_id": event.run_id,
                                "status": event.status,
                                "phase": "end",
                            },
                        )
                    )
                elif event.kind == "trace":
                    yield agui.encode_sse(
                        agui.custom(
                            "allhands.trace",
                            {"trace_id": event.trace_id, "url": event.url},
                        )
                    )
                elif event.kind == "error":
                    closing = _close_open_message()
                    if closing is not None:
                        yield closing
                    yield agui.encode_sse(agui.run_error(event.message, event.code))
                    finished = True
                elif event.kind == "done":
                    closing = _close_open_message()
                    if closing is not None:
                        yield closing
                    yield agui.encode_sse(agui.run_finished(conversation_id, run_id))
                    finished = True
        except DomainError as exc:
            closing = _close_open_message()
            if closing is not None:
                yield closing
            yield agui.encode_sse(agui.run_error(str(exc), "DOMAIN_ERROR"))
            finished = True
        except asyncio.CancelledError:
            log.info(
                "chat.send_message: stream cancelled by runtime",
                extra={"conversation_id": conversation_id},
            )
            raise
        except Exception as exc:
            closing = _close_open_message()
            if closing is not None:
                yield closing
            yield agui.encode_sse(agui.run_error(str(exc), "INTERNAL"))
            finished = True
        finally:
            if not finished:
                closing = _close_open_message()
                if closing is not None:
                    yield closing
                yield agui.encode_sse(agui.run_finished(conversation_id, run_id))
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

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
