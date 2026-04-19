"""LLMModelService — CRUD + connectivity/chat test for provider-hosted models.

The test surface mirrors production capability (P11 · D3/D4):
  - real `astream` streaming (TTFT + tok/s)
  - full parameter panel (system / temperature / top_p / max_tokens / stop)
  - multi-turn via `messages[]`
  - categorized failure reason
  - latency + token usage + optional cost
Shared by the REST route and the `chat_test_model` meta tool.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import AsyncIterator
from typing import Any, Literal

from allhands.core.model import LLMModel
from allhands.core.provider import LLMProvider
from allhands.persistence.repositories import LLMModelRepo, LLMProviderRepo

ErrorCategory = Literal[
    "timeout",
    "auth",
    "rate_limit",
    "model_not_found",
    "connection",
    "context_length",
    "provider_error",
    "unknown",
]


class LLMModelService:
    def __init__(self, model_repo: LLMModelRepo, provider_repo: LLMProviderRepo) -> None:
        self._models = model_repo
        self._providers = provider_repo

    async def create(
        self,
        provider_id: str,
        name: str,
        display_name: str = "",
        context_window: int = 0,
    ) -> LLMModel | None:
        provider = await self._providers.get(provider_id)
        if provider is None:
            return None
        model = LLMModel(
            id=str(uuid.uuid4()),
            provider_id=provider_id,
            name=name,
            display_name=display_name or name,
            context_window=context_window,
        )
        return await self._models.upsert(model)

    async def get(self, model_id: str) -> LLMModel | None:
        return await self._models.get(model_id)

    async def list_all(self) -> list[LLMModel]:
        return await self._models.list_all()

    async def list_for_provider(self, provider_id: str) -> list[LLMModel]:
        return await self._models.list_for_provider(provider_id)

    async def update(
        self,
        model_id: str,
        *,
        name: str | None = None,
        display_name: str | None = None,
        context_window: int | None = None,
        enabled: bool | None = None,
    ) -> LLMModel | None:
        model = await self._models.get(model_id)
        if model is None:
            return None
        updated = model.model_copy(
            update={
                k: v
                for k, v in {
                    "name": name,
                    "display_name": display_name,
                    "context_window": context_window,
                    "enabled": enabled,
                }.items()
                if v is not None
            }
        )
        return await self._models.upsert(updated)

    async def delete(self, model_id: str) -> None:
        await self._models.delete(model_id)

    async def resolve_with_provider(self, model_id: str) -> tuple[LLMModel, LLMProvider] | None:
        model = await self._models.get(model_id)
        if model is None:
            return None
        provider = await self._providers.get(model.provider_id)
        if provider is None:
            return None
        return model, provider


# ---------------------------------------------------------------------------
# Error categorization — convert raw exception text into a UI-grade category.
# ---------------------------------------------------------------------------

_CATEGORY_SIGNATURES: list[tuple[ErrorCategory, tuple[str, ...]]] = [
    ("timeout", ("timeout", "timed out", "timeouterror")),
    ("auth", ("invalid api key", "unauthorized", "401", "incorrect api key", "authentication")),
    ("rate_limit", ("rate limit", "429", "too many requests")),
    (
        "model_not_found",
        ("model not found", "does not exist", "404", "invalid model", "unknown model"),
    ),
    ("context_length", ("maximum context", "context length", "context_length_exceeded")),
    (
        "connection",
        ("connection", "connectionerror", "getaddrinfo", "nameresolutionerror", "econnrefused"),
    ),
]


def categorize_error(exc: BaseException) -> ErrorCategory:
    blob = f"{type(exc).__name__}: {exc!s}".lower()
    for category, needles in _CATEGORY_SIGNATURES:
        if any(n in blob for n in needles):
            return category
    # 5xx from upstream that didn't match more specific signatures
    if " 5" in blob and ("status" in blob or "http" in blob):
        return "provider_error"
    return "unknown"


def _build_messages(
    *,
    system: str | None,
    messages: list[dict[str, str]] | None,
    prompt: str | None,
) -> list[Any]:
    """Normalize UI inputs to LangChain messages. Prefer messages[] over prompt."""
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

    out: list[Any] = []
    if system:
        out.append(SystemMessage(content=system))
    if messages:
        for m in messages:
            role = (m.get("role") or "user").lower()
            content = m.get("content", "")
            if role == "system":
                out.append(SystemMessage(content=content))
            elif role == "assistant":
                out.append(AIMessage(content=content))
            else:
                out.append(HumanMessage(content=content))
    elif prompt is not None:
        out.append(HumanMessage(content=prompt))
    return out


def _llm_kwargs(
    provider: LLMProvider,
    model_name: str,
    *,
    temperature: float | None,
    top_p: float | None,
    max_tokens: int | None,
    stop: list[str] | None,
    stream_usage: bool = False,
) -> dict[str, Any]:
    kwargs: dict[str, Any] = {"model": model_name}
    if provider.api_key:
        kwargs["api_key"] = provider.api_key
    if provider.base_url:
        kwargs["base_url"] = provider.base_url
    if temperature is not None:
        kwargs["temperature"] = temperature
    if top_p is not None:
        kwargs["top_p"] = top_p
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    if stop:
        kwargs["stop"] = stop
    if stream_usage:
        kwargs["stream_usage"] = True
    return kwargs


async def run_chat_test(
    provider: LLMProvider,
    model_name: str,
    *,
    prompt: str | None = "ping",
    messages: list[dict[str, str]] | None = None,
    system: str | None = None,
    temperature: float | None = None,
    top_p: float | None = None,
    max_tokens: int | None = None,
    stop: list[str] | None = None,
) -> dict[str, Any]:
    """Single non-streaming chat call with full metrics.

    Returns a dict safe for JSON serialization. On failure, `ok=False` and
    `error` + `error_category` fields are populated; metric fields may be zero.
    """
    try:
        from langchain_openai import ChatOpenAI
    except ImportError as exc:  # pragma: no cover — langchain is a hard dep
        return {
            "ok": False,
            "model": model_name,
            "error": f"langchain-openai missing: {exc}",
            "error_category": "unknown",
        }

    payload = _build_messages(system=system, messages=messages, prompt=prompt)
    llm = ChatOpenAI(
        **_llm_kwargs(
            provider,
            model_name,
            temperature=temperature,
            top_p=top_p,
            max_tokens=max_tokens,
            stop=stop,
            stream_usage=False,
        )
    )
    started = time.perf_counter()
    try:
        resp = await llm.ainvoke(payload)
    except Exception as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        return {
            "ok": False,
            "model": model_name,
            "latency_ms": latency_ms,
            "error": str(exc),
            "error_category": categorize_error(exc),
        }
    latency_ms = int((time.perf_counter() - started) * 1000)
    usage = getattr(resp, "usage_metadata", None) or {}
    return {
        "ok": True,
        "model": model_name,
        "response": str(resp.content),
        "latency_ms": latency_ms,
        "usage": {
            "input_tokens": int(usage.get("input_tokens", 0) or 0),
            "output_tokens": int(usage.get("output_tokens", 0) or 0),
            "total_tokens": int(usage.get("total_tokens", 0) or 0),
        },
    }


async def astream_chat_test(
    provider: LLMProvider,
    model_name: str,
    *,
    prompt: str | None = None,
    messages: list[dict[str, str]] | None = None,
    system: str | None = None,
    temperature: float | None = None,
    top_p: float | None = None,
    max_tokens: int | None = None,
    stop: list[str] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Stream a chat test as a sequence of event dicts.

    Events:
      - {"type": "meta", "model": str, "started_at_ms": int}
      - {"type": "delta", "text": str}
      - {"type": "done", "latency_ms": int, "ttft_ms": int, "usage": {...}, "tokens_per_second": float, "response": str}
      - {"type": "error", "error": str, "error_category": str, "latency_ms": int}
    """
    try:
        from langchain_openai import ChatOpenAI
    except ImportError as exc:  # pragma: no cover
        yield {
            "type": "error",
            "error": f"langchain-openai missing: {exc}",
            "error_category": "unknown",
            "latency_ms": 0,
        }
        return

    payload = _build_messages(system=system, messages=messages, prompt=prompt)
    llm = ChatOpenAI(
        **_llm_kwargs(
            provider,
            model_name,
            temperature=temperature,
            top_p=top_p,
            max_tokens=max_tokens,
            stop=stop,
            stream_usage=True,
        )
    )
    started = time.perf_counter()
    first_chunk_at: float | None = None
    assembled: list[str] = []
    final_usage: dict[str, Any] = {}

    yield {"type": "meta", "model": model_name, "started_at_ms": int(started * 1000)}
    try:
        async for chunk in llm.astream(payload):
            if first_chunk_at is None:
                first_chunk_at = time.perf_counter()
            text = str(chunk.content) if chunk.content else ""
            if text:
                assembled.append(text)
                yield {"type": "delta", "text": text}
            # some providers include cumulative usage on intermediate chunks too
            chunk_usage = getattr(chunk, "usage_metadata", None)
            if chunk_usage:
                final_usage = chunk_usage
    except Exception as exc:
        latency_ms = int((time.perf_counter() - started) * 1000)
        yield {
            "type": "error",
            "error": str(exc),
            "error_category": categorize_error(exc),
            "latency_ms": latency_ms,
        }
        return

    latency_ms = int((time.perf_counter() - started) * 1000)
    ttft_ms = int((first_chunk_at - started) * 1000) if first_chunk_at else latency_ms
    response = "".join(assembled)
    output_tokens = int(final_usage.get("output_tokens", 0) or 0)
    elapsed_s = max((time.perf_counter() - (first_chunk_at or started)), 1e-6)
    tok_per_sec = (output_tokens / elapsed_s) if output_tokens else 0.0

    yield {
        "type": "done",
        "latency_ms": latency_ms,
        "ttft_ms": ttft_ms,
        "usage": {
            "input_tokens": int(final_usage.get("input_tokens", 0) or 0),
            "output_tokens": output_tokens,
            "total_tokens": int(final_usage.get("total_tokens", 0) or 0),
        },
        "tokens_per_second": round(tok_per_sec, 2),
        "response": response,
    }
