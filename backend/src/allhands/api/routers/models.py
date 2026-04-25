"""LLM Model management endpoints (models under providers)."""

from __future__ import annotations

import secrets
import time
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from allhands.api import ag_ui_encoder as agui
from allhands.api.deps import get_model_service, get_session
from allhands.core.model import LLMModel
from allhands.services.connectivity import (
    ENDPOINT_TIMEOUT_S,
    MODEL_TIMEOUT_S,
    overall_status,
    probe_endpoint,
    probe_model,
    to_legacy_shape,
)
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


@router.post("/{model_id}/ping", response_model=dict)
async def ping_model(
    model_id: str,
    session: AsyncSession = Depends(get_session),
) -> dict[str, object]:
    """Two-layer connectivity ping (I-0019 · 第一性原理重构).

    "连通" 拆成两个独立维度,分别返回:

    1. **endpoint** — 端点能否被这把 key 触达。GET `/v1/models`,不调推理。
       亚秒级;只判网络 + auth 是否通过。
    2. **model_probe** — 这个 model name 能否被这条 (provider, key) 路由。
       最小 chat 调用 (max_tokens=1, 单条 user msg, 不带 thinking/temp/system)。
       白名单分类 — 仅 NETWORK / TIMEOUT / AUTH / MODEL_NOT_FOUND 判 unusable;
       400 / 422 / 429 / 5xx / 慢都视为"模型还在,只是这次调用本身有别的问题"。

    Returns ``{endpoint, model_probe, status, ok, latency_ms, error?, error_category?}``
    where the bottom 4 fields are kept for backward-compat with the existing
    Gateway UI. Status ∈ ``ok | degraded | endpoint_unreachable | auth_failed
    | model_unavailable``.
    """
    svc = await get_model_service(session)
    pair = await svc.resolve_with_provider(model_id)
    if pair is None:
        raise HTTPException(status_code=404, detail="Model or provider not found.")
    model, provider = pair

    async with httpx.AsyncClient(timeout=ENDPOINT_TIMEOUT_S) as ec:
        endpoint = await probe_endpoint(provider, http_client=ec)

    # If we couldn't even reach the endpoint, skip the model probe — running
    # a 12s chat probe against a dead host just doubles the user's wait.
    if not endpoint.reachable or endpoint.auth_ok is False:
        from allhands.services.connectivity import ModelProbe

        skipped = ModelProbe(
            usable=False,
            classification="network" if not endpoint.reachable else "auth",
            status_code=None,
            latency_ms=0,
            error="skipped: endpoint unreachable"
            if not endpoint.reachable
            else "skipped: auth failed",
        )
        status = overall_status(endpoint, skipped)
        return to_legacy_shape(
            model_name=model.name, endpoint=endpoint, model=skipped, status=status
        )

    async with httpx.AsyncClient(timeout=MODEL_TIMEOUT_S) as mc:
        m_probe = await probe_model(provider, model.name, http_client=mc)
    status = overall_status(endpoint, m_probe)
    return to_legacy_shape(model_name=model.name, endpoint=endpoint, model=m_probe, status=status)


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
    """Streaming chat test — AG-UI v1 SSE (I-0017 / ADR 0010).

    Wire sequence:
      RUN_STARTED -> CUSTOM(allhands.model_test_meta)
        -> TEXT_MESSAGE_START -> TEXT_MESSAGE_CHUNK * N
        -> (optional) REASONING_MESSAGE_CHUNK * N
        -> TEXT_MESSAGE_END -> CUSTOM(allhands.model_test_metrics)
        -> RUN_FINISHED
      RUN_ERROR on failure (with CUSTOM allhands.model_test_error for legacy
      `error_category` / `latency_ms` payload).
    """
    svc = await get_model_service(session)
    pair = await svc.resolve_with_provider(model_id)
    if pair is None:
        raise HTTPException(status_code=404, detail="Model or provider not found.")
    model, provider = pair
    kwargs = _to_svc_kwargs(body)

    async def _sse() -> AsyncIterator[bytes]:
        thread_id = f"mt_{int(time.time() * 1000)}_{secrets.token_hex(4)}"
        run_id = f"run_{secrets.token_hex(8)}"
        message_id = f"msg_{secrets.token_hex(8)}"
        reasoning_id = f"msg_{secrets.token_hex(8)}"
        yield agui.encode_sse(agui.run_started(thread_id, run_id))
        started_text = False
        started_reasoning = False
        async for evt in astream_chat_test(provider, model.name, **kwargs):
            kind = evt.get("type")
            if kind == "meta":
                payload = {k: v for k, v in evt.items() if k != "type"}
                yield agui.encode_sse(agui.custom("allhands.model_test_meta", payload))
            elif kind == "delta":
                text = evt.get("text", "")
                if not started_text:
                    yield agui.encode_sse(agui.text_message_start(message_id))
                    started_text = True
                yield agui.encode_sse(agui.text_message_chunk(message_id, text))
            elif kind == "reasoning":
                text = evt.get("text", "")
                if not started_reasoning:
                    started_reasoning = True
                yield agui.encode_sse(agui.reasoning_message_chunk(reasoning_id, text))
            elif kind == "done":
                if started_reasoning:
                    yield agui.encode_sse(agui.reasoning_message_end(reasoning_id))
                if started_text:
                    yield agui.encode_sse(agui.text_message_end(message_id))
                metrics = {k: v for k, v in evt.items() if k != "type"}
                yield agui.encode_sse(agui.custom("allhands.model_test_metrics", metrics))
                yield agui.encode_sse(agui.run_finished(thread_id, run_id))
            elif kind == "error":
                err_msg = str(evt.get("error", "upstream error"))
                err_code = str(evt.get("error_category", "INTERNAL"))
                yield agui.encode_sse(
                    agui.custom(
                        "allhands.model_test_error",
                        {k: v for k, v in evt.items() if k != "type"},
                    )
                )
                yield agui.encode_sse(agui.run_error(err_msg, err_code))

    return StreamingResponse(
        _sse(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
