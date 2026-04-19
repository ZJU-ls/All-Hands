"""LLM Model management endpoints (models under providers)."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from allhands.api.deps import get_model_service, get_session
from allhands.core.model import LLMModel
from allhands.services.model_service import astream_chat_test, run_chat_test

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/models", tags=["models"])


class ModelResponse(BaseModel):
    id: str
    provider_id: str
    name: str
    display_name: str
    context_window: int
    enabled: bool


class CreateModelRequest(BaseModel):
    provider_id: str
    name: str
    display_name: str = ""
    context_window: int = 0


class UpdateModelRequest(BaseModel):
    name: str | None = None
    display_name: str | None = None
    context_window: int | None = None
    enabled: bool | None = None


class ChatMessage(BaseModel):
    role: str = "user"
    content: str = ""


class ChatTestRequest(BaseModel):
    """Rich request mirroring production chat capability (P11 · D4)."""

    prompt: str | None = "ping"
    messages: list[ChatMessage] | None = None
    system: str | None = None
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)
    max_tokens: int | None = Field(default=None, ge=1, le=32_000)
    stop: list[str] | None = None
    enable_thinking: bool | None = Field(
        default=None,
        description=(
            "Turn provider-side reasoning on/off for thinking models "
            "(Qwen3 / DeepSeek-R1 / o1). Passed through as OpenAI extra body."
        ),
    )


def _to_response(m: LLMModel) -> ModelResponse:
    return ModelResponse(
        id=m.id,
        provider_id=m.provider_id,
        name=m.name,
        display_name=m.display_name,
        context_window=m.context_window,
        enabled=m.enabled,
    )


def _to_svc_kwargs(body: ChatTestRequest | None) -> dict[str, Any]:
    if body is None:
        return {"prompt": "ping"}
    msgs = [m.model_dump() for m in body.messages] if body.messages else None
    return {
        "prompt": body.prompt if not msgs else None,
        "messages": msgs,
        "system": body.system,
        "temperature": body.temperature,
        "top_p": body.top_p,
        "max_tokens": body.max_tokens,
        "stop": body.stop,
        "enable_thinking": body.enable_thinking,
    }


@router.get("", response_model=list[ModelResponse])
async def list_models(
    provider_id: str | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[ModelResponse]:
    svc = await get_model_service(session)
    items = await svc.list_for_provider(provider_id) if provider_id else await svc.list_all()
    return [_to_response(m) for m in items]


@router.post("", response_model=ModelResponse, status_code=201)
async def create_model(
    body: CreateModelRequest,
    session: AsyncSession = Depends(get_session),
) -> ModelResponse:
    svc = await get_model_service(session)
    model = await svc.create(
        provider_id=body.provider_id,
        name=body.name,
        display_name=body.display_name,
        context_window=body.context_window,
    )
    if model is None:
        raise HTTPException(status_code=404, detail="Provider not found.")
    return _to_response(model)


@router.patch("/{model_id}", response_model=ModelResponse)
async def update_model(
    model_id: str,
    body: UpdateModelRequest,
    session: AsyncSession = Depends(get_session),
) -> ModelResponse:
    svc = await get_model_service(session)
    model = await svc.update(
        model_id,
        name=body.name,
        display_name=body.display_name,
        context_window=body.context_window,
        enabled=body.enabled,
    )
    if model is None:
        raise HTTPException(status_code=404, detail="Model not found.")
    return _to_response(model)


@router.delete("/{model_id}", status_code=204)
async def delete_model(
    model_id: str,
    session: AsyncSession = Depends(get_session),
) -> None:
    svc = await get_model_service(session)
    await svc.delete(model_id)


@router.post("/{model_id}/test", response_model=dict)
async def test_model(
    model_id: str,
    body: ChatTestRequest | None = None,
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    """Single-shot chat test. Returns latency/usage/response or categorized error."""
    svc = await get_model_service(session)
    pair = await svc.resolve_with_provider(model_id)
    if pair is None:
        raise HTTPException(status_code=404, detail="Model or provider not found.")
    model, provider = pair
    return await run_chat_test(provider, model.name, **_to_svc_kwargs(body))


@router.post("/{model_id}/test/stream")
async def test_model_stream(
    model_id: str,
    body: ChatTestRequest | None = None,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    """Streaming chat test — production-grade SSE (P11 · D4 parity).

    Event stream ( `text/event-stream` ):
      event: meta      | data: {model, started_at_ms}
      event: reasoning | data: {text}            # delta of reasoning_content (thinking models)
      event: delta     | data: {text}            # delta of visible content
      event: done      | data: {latency_ms, ttft_ms, reasoning_first_ms, usage,
                                tokens_per_second, response, reasoning_text}
      event: error     | data: {error, error_category, latency_ms}
    """
    svc = await get_model_service(session)
    pair = await svc.resolve_with_provider(model_id)
    if pair is None:
        raise HTTPException(status_code=404, detail="Model or provider not found.")
    model, provider = pair
    kwargs = _to_svc_kwargs(body)

    async def _sse() -> AsyncIterator[bytes]:
        async for evt in astream_chat_test(provider, model.name, **kwargs):
            event = evt.get("type", "message")
            payload = {k: v for k, v in evt.items() if k != "type"}
            yield f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n".encode()

    return StreamingResponse(
        _sse(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
