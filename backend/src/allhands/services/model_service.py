"""LLMModelService — CRUD + connectivity/chat test for provider-hosted models.

The test surface mirrors production capability (P11 · D3/D4):
  - real SSE streaming (TTFT + tok/s)
  - full parameter panel (system / temperature / top_p / max_tokens / stop)
  - reasoning-content pass-through for thinking models (Qwen / DeepSeek / o1)
  - enable_thinking toggle for DashScope-family reasoning models
  - multi-turn via `messages[]`
  - categorized failure reason
  - latency + token usage

We hit the OpenAI-compatible `/chat/completions` endpoint directly via
`httpx`, rather than going through `langchain_openai`. Rationale (L03 · P11
子维度 ④): `langchain_openai` drops `delta.reasoning_content` when rebuilding
`AIMessageChunk`, so thinking content never reaches the UI — the user sees
17 s of silence followed by a one-shot paste instead of a live thinking
stream. The test surface must faithfully reflect what the provider streams.

Kind-aware dispatch (E13): when `provider.kind == "anthropic"` we speak the
Anthropic Messages API natively (`/v1/messages` · `x-api-key` ·
`anthropic-version`). Before this, providers whose ONLY endpoint is
`/v1/messages` — DashScope coding-plan gateway, Anthropic native, proxies
sitting in front of Claude — returned 404 on ping even though the Lead
Agent runtime worked (the runtime goes through `build_llm → ChatAnthropic`
which already dispatches correctly). The gateway UI then showed "no
models" next to a working provider. Keep the two code paths in sync.

Shared by the REST route and the `chat_test_model` meta tool.
"""

from __future__ import annotations

import json
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any, Literal

import httpx

from allhands.core.model import LLMModel
from allhands.core.provider import LLMProvider
from allhands.i18n import t
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


class ModelConfigError(ValueError):
    """Raised when a model payload is structurally valid but semantically broken."""


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
        max_input_tokens: int | None = None,
        max_output_tokens: int | None = None,
        supports_images: bool | None = None,
    ) -> LLMModel | None:
        # 2026-04-25: token caps are optional advanced settings. Registration
        # only requires (provider, name) — caps default to None ("use model
        # default") and the composer falls back to a sane denominator. Reject
        # negative caps explicitly so bad values can't reach the DB; zero is
        # treated as "unset" to keep CSV bulk-import scripts simple.
        if context_window < 0:
            raise ModelConfigError(f"context_window must be >= 0 (got {context_window}).")
        if max_input_tokens is not None and max_input_tokens <= 0:
            raise ModelConfigError(
                f"max_input_tokens must be > 0 when provided (got {max_input_tokens})."
            )
        if max_output_tokens is not None and max_output_tokens <= 0:
            raise ModelConfigError(
                f"max_output_tokens must be > 0 when provided (got {max_output_tokens})."
            )
        provider = await self._providers.get(provider_id)
        if provider is None:
            return None
        # Vision capability: explicit caller value wins; otherwise auto-detect
        # from the model name (covers claude-3+, gpt-4o, qwen-vl, gemini, …).
        if supports_images is None:
            from allhands.services.vision_capability import infer_supports_images

            supports_images = infer_supports_images(name)
        model = LLMModel(
            id=str(uuid.uuid4()),
            provider_id=provider_id,
            name=name,
            display_name=display_name or name,
            context_window=context_window,
            max_input_tokens=max_input_tokens,
            max_output_tokens=max_output_tokens,
            supports_images=supports_images,
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
        max_input_tokens: int | None = None,
        max_output_tokens: int | None = None,
        enabled: bool | None = None,
        supports_images: bool | None = None,
    ) -> LLMModel | None:
        if context_window is not None and context_window < 0:
            raise ModelConfigError(f"context_window must be >= 0 (got {context_window}).")
        if max_input_tokens is not None and max_input_tokens <= 0:
            raise ModelConfigError(
                f"max_input_tokens must be > 0 when provided (got {max_input_tokens})."
            )
        if max_output_tokens is not None and max_output_tokens <= 0:
            raise ModelConfigError(
                f"max_output_tokens must be > 0 when provided (got {max_output_tokens})."
            )
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
                    "max_input_tokens": max_input_tokens,
                    "max_output_tokens": max_output_tokens,
                    "enabled": enabled,
                    "supports_images": supports_images,
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

    async def get_default(self) -> tuple[LLMModel, LLMProvider] | None:
        """Return the workspace default (model, provider) pair, or None.

        Reads the singleton `LLMModel.is_default=True` row and joins to its
        provider. The pair is the canonical "what does the workspace use
        when nothing else is specified" pointer — reused by ai_explainer,
        Lead Agent's bootstrap snapshot, model_resolution.
        """
        model = await self._models.get_default()
        if model is None:
            return None
        provider = await self._providers.get(model.provider_id)
        if provider is None:
            return None
        return model, provider

    async def set_as_default(self, model_id: str) -> tuple[LLMModel, LLMProvider] | None:
        """Promote one model to the workspace default. Atomic + singleton.

        Wraps the repo's transaction (clear all, set this) and joins the
        provider so the API response can render "你已切到 X · Y" in one call.
        """
        updated = await self._models.set_default(model_id)
        if updated is None:
            return None
        provider = await self._providers.get(updated.provider_id)
        if provider is None:
            # Orphan model — shouldn't happen with FK cascade, but be honest.
            return None
        return updated, provider


# ---------------------------------------------------------------------------
# Error categorization — convert raw exception text into a UI-grade category.
# ---------------------------------------------------------------------------

_CATEGORY_SIGNATURES: list[tuple[ErrorCategory, tuple[str, ...]]] = [
    ("timeout", ("timeout", "timed out", "timeouterror", "readtimeout")),
    ("auth", ("invalid api key", "unauthorized", "401", "incorrect api key", "authentication")),
    ("rate_limit", ("rate limit", "429", "too many requests")),
    (
        "model_not_found",
        ("model not found", "does not exist", "404", "invalid model", "unknown model"),
    ),
    ("context_length", ("maximum context", "context length", "context_length_exceeded")),
    (
        "connection",
        (
            "connection",
            "connectionerror",
            "getaddrinfo",
            "nameresolutionerror",
            "econnrefused",
            "connecterror",
        ),
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


def categorize_http_status(status: int) -> ErrorCategory:
    """Classify an upstream HTTP status into our canonical category bucket."""
    if status == 401 or status == 403:
        return "auth"
    if status == 404:
        return "model_not_found"
    if status == 408 or status == 504:
        return "timeout"
    if status == 429:
        return "rate_limit"
    if 500 <= status < 600:
        return "provider_error"
    return "unknown"


# ---------------------------------------------------------------------------
# OpenAI-compat request assembly
# ---------------------------------------------------------------------------


def _build_openai_messages(
    *,
    system: str | None,
    messages: list[dict[str, str]] | None,
    prompt: str | None,
) -> list[dict[str, str]]:
    """Normalize UI inputs to an OpenAI-compatible messages array.

    Precedence: explicit `messages[]` > single `prompt` string. If `system`
    is non-empty it is prepended as a system message.
    """
    out: list[dict[str, str]] = []
    if system and system.strip():
        out.append({"role": "system", "content": system})
    if messages:
        for m in messages:
            role = (m.get("role") or "user").lower()
            if role not in ("system", "user", "assistant"):
                role = "user"
            out.append({"role": role, "content": m.get("content", "")})
    elif prompt is not None:
        out.append({"role": "user", "content": prompt})
    return out


def _build_openai_body(
    *,
    model_name: str,
    messages: list[dict[str, str]],
    temperature: float | None,
    top_p: float | None,
    max_tokens: int | None,
    stop: list[str] | None,
    enable_thinking: bool | None,
    stream: bool,
) -> dict[str, Any]:
    body: dict[str, Any] = {"model": model_name, "messages": messages}
    if stream:
        body["stream"] = True
        body["stream_options"] = {"include_usage": True}
    if temperature is not None:
        body["temperature"] = temperature
    if top_p is not None:
        body["top_p"] = top_p
    if max_tokens is not None:
        body["max_tokens"] = max_tokens
    if stop:
        body["stop"] = stop
    if enable_thinking is not None:
        # DashScope / Qwen extended param; OpenAI-proper simply ignores unknown fields.
        body["enable_thinking"] = enable_thinking
    return body


def _headers(provider: LLMProvider) -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    if provider.api_key:
        h["Authorization"] = f"Bearer {provider.api_key}"
    return h


def _base_url(provider: LLMProvider) -> str:
    base = (provider.base_url or "").rstrip("/")
    return base or "https://api.openai.com/v1"


# ---------------------------------------------------------------------------
# Anthropic Messages API (used when provider.kind == "anthropic")
# ---------------------------------------------------------------------------

ANTHROPIC_VERSION = "2023-06-01"
ANTHROPIC_DEFAULT_MAX_TOKENS = 1024


def _is_anthropic(provider: LLMProvider) -> bool:
    return getattr(provider, "kind", "openai") == "anthropic"


def _is_native_anthropic_base(base_url: str | None) -> bool:
    """True when base_url points at api.anthropic.com (not a compat gateway).

    Kept for callers that historically branched on it; the new opt-in-only
    thinking policy doesn't actually need to distinguish (we never send
    `thinking: disabled` to anyone).
    """
    base = (base_url or "").lower()
    return "api.anthropic.com" in base


def _anthropic_headers(provider: LLMProvider) -> dict[str, str]:
    h = {
        "Content-Type": "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
    }
    if provider.api_key:
        h["x-api-key"] = provider.api_key
    return h


def _anthropic_url(provider: LLMProvider, endpoint: str = "/v1/messages") -> str:
    base = (provider.base_url or "").rstrip("/")
    if not base:
        base = "https://api.anthropic.com"
    if base.endswith("/v1"):
        # Proxies advertising a /v1 root — don't double-prepend.
        return base + endpoint[len("/v1") :]
    return base + endpoint


def _split_system_and_messages(
    *, system: str | None, messages: list[dict[str, str]] | None, prompt: str | None
) -> tuple[str | None, list[dict[str, str]]]:
    """Split UI inputs into (system_text, non_system_messages) for Anthropic.

    Anthropic's Messages API rejects `role: system` inside the messages array
    — the system prompt must live at the top level. If the caller passes a
    system role inside `messages[]` (legacy shape), we promote it.
    """
    sys_parts: list[str] = []
    if system and system.strip():
        sys_parts.append(system.strip())
    out: list[dict[str, str]] = []
    if messages:
        for m in messages:
            role = (m.get("role") or "user").lower()
            content = m.get("content", "")
            if role == "system":
                if content:
                    sys_parts.append(content)
                continue
            if role not in ("user", "assistant"):
                role = "user"
            out.append({"role": role, "content": content})
    elif prompt is not None:
        out.append({"role": "user", "content": prompt})
    return ("\n\n".join(sys_parts) or None, out)


def _build_anthropic_body(
    *,
    model_name: str,
    system: str | None,
    messages: list[dict[str, str]],
    temperature: float | None,
    top_p: float | None,
    max_tokens: int | None,
    stop: list[str] | None,
    stream: bool,
    enable_thinking: bool | None = None,
    native_anthropic: bool = False,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": model_name,
        "messages": messages,
        "max_tokens": max_tokens if max_tokens is not None else ANTHROPIC_DEFAULT_MAX_TOKENS,
    }
    if system:
        body["system"] = system
    if stream:
        body["stream"] = True
    if temperature is not None:
        body["temperature"] = temperature
    if top_p is not None:
        body["top_p"] = top_p
    if stop:
        body["stop_sequences"] = stop
    # Toggle 语义(2026-04-25 final):用户的显式决策必须被执行,不能因为
    # vendor 默认行为不一致就把 toggle 变成"建议性"。
    #
    # - True  → 发 thinking: enabled  (强制思考)
    # - False → 发 thinking: disabled (强制不思考 — 用户点 off 就该 off)
    # - None  → 不发 thinking 字段     (没指定,用 server default)
    #
    # 唯一例外:Native api.anthropic.com 协议层面拒绝 "disabled"(400),
    # 它的 server default 本来就是 no-thinking,所以 False 时 omit 即可。
    # 这是协议事实,不是 vendor 偏好。
    #
    # 半 anthropic-compat 反代(IDEALAB / 自建网关)不识别 thinking 字段 →
    # 上游返回空 SSE → 由 _astream_anthropic_chat 的空响应检测兜底报错。
    # 报错路径,不是默认路径 —— 用户偏好 > 上游兼容性。
    if enable_thinking is True:
        body["thinking"] = {
            "type": "enabled",
            "budget_tokens": ANTHROPIC_DEFAULT_MAX_TOKENS // 2,
        }
    elif enable_thinking is False and not native_anthropic:
        body["thinking"] = {"type": "disabled"}
    return body


def _anthropic_text_from_response(data: dict[str, Any]) -> str:
    """Extract plain text from an Anthropic `messages.create` response body."""
    blocks = data.get("content") or []
    parts: list[str] = []
    for b in blocks:
        if isinstance(b, dict) and b.get("type") == "text":
            parts.append(str(b.get("text") or ""))
    return "".join(parts)


def _anthropic_usage(data: dict[str, Any]) -> dict[str, int]:
    u = data.get("usage") or {}
    input_t = int(u.get("input_tokens") or 0)
    output_t = int(u.get("output_tokens") or 0)
    return {"input_tokens": input_t, "output_tokens": output_t, "total_tokens": input_t + output_t}


async def _run_anthropic_chat(
    provider: LLMProvider,
    model_name: str,
    *,
    prompt: str | None,
    messages: list[dict[str, str]] | None,
    system: str | None,
    temperature: float | None,
    top_p: float | None,
    max_tokens: int | None,
    stop: list[str] | None,
    enable_thinking: bool | None,
    http_client: httpx.AsyncClient | None,
) -> dict[str, Any]:
    sys_text, msgs = _split_system_and_messages(system=system, messages=messages, prompt=prompt)
    body = _build_anthropic_body(
        model_name=model_name,
        system=sys_text,
        messages=msgs,
        temperature=temperature,
        top_p=top_p,
        max_tokens=max_tokens,
        stop=stop,
        stream=False,
        enable_thinking=enable_thinking,
        native_anthropic=_is_native_anthropic_base(provider.base_url),
    )
    url = _anthropic_url(provider)
    started = time.perf_counter()

    client = http_client or httpx.AsyncClient(timeout=120)
    owns_client = http_client is None
    try:
        try:
            resp = await client.post(url, headers=_anthropic_headers(provider), json=body)
        except Exception as exc:
            return {
                "ok": False,
                "model": model_name,
                "latency_ms": int((time.perf_counter() - started) * 1000),
                "error": str(exc),
                "error_category": categorize_error(exc),
            }
        latency_ms = int((time.perf_counter() - started) * 1000)
        if resp.status_code >= 400:
            return {
                "ok": False,
                "model": model_name,
                "latency_ms": latency_ms,
                "error": f"HTTP {resp.status_code}: {resp.text[:500]}",
                "error_category": categorize_http_status(resp.status_code),
            }
        data = resp.json()
    finally:
        if owns_client:
            await client.aclose()

    return {
        "ok": True,
        "model": model_name,
        "response": _anthropic_text_from_response(data),
        "reasoning_text": "",
        "latency_ms": latency_ms,
        "usage": _anthropic_usage(data),
    }


# ---------------------------------------------------------------------------
# run_chat_test — single non-streaming call
# ---------------------------------------------------------------------------


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
    enable_thinking: bool | None = None,
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Single non-streaming chat call with full metrics + reasoning passthrough.

    Returns a dict safe for JSON serialization. On failure, `ok=False` and
    `error` + `error_category` fields are populated; metric fields may be zero.
    For reasoning models (Qwen3 thinking / DeepSeek-R1 / o1), the
    `message.reasoning_content` field is preserved as `reasoning_text` when
    present so tests surface what production would reveal.
    """
    if _is_anthropic(provider):
        return await _run_anthropic_chat(
            provider,
            model_name,
            prompt=prompt,
            messages=messages,
            system=system,
            temperature=temperature,
            top_p=top_p,
            max_tokens=max_tokens,
            stop=stop,
            enable_thinking=enable_thinking,
            http_client=http_client,
        )
    body = _build_openai_body(
        model_name=model_name,
        messages=_build_openai_messages(system=system, messages=messages, prompt=prompt),
        temperature=temperature,
        top_p=top_p,
        max_tokens=max_tokens,
        stop=stop,
        enable_thinking=enable_thinking,
        stream=False,
    )
    url = _base_url(provider) + "/chat/completions"
    started = time.perf_counter()

    client = http_client or httpx.AsyncClient(timeout=120)
    owns_client = http_client is None
    try:
        try:
            resp = await client.post(url, headers=_headers(provider), json=body)
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
        if resp.status_code >= 400:
            return {
                "ok": False,
                "model": model_name,
                "latency_ms": latency_ms,
                "error": f"HTTP {resp.status_code}: {resp.text[:500]}",
                "error_category": categorize_http_status(resp.status_code),
            }
        data = resp.json()
    finally:
        if owns_client:
            await client.aclose()

    choices = data.get("choices") or [{}]
    msg = (choices[0].get("message") or {}) if choices else {}
    usage = data.get("usage") or {}
    return {
        "ok": True,
        "model": model_name,
        "response": str(msg.get("content") or ""),
        "reasoning_text": str(msg.get("reasoning_content") or ""),
        "latency_ms": latency_ms,
        "usage": {
            "input_tokens": int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0),
            "output_tokens": int(usage.get("completion_tokens") or usage.get("output_tokens") or 0),
            "total_tokens": int(usage.get("total_tokens") or 0),
        },
    }


# ---------------------------------------------------------------------------
# astream_chat_test — SSE streaming with reasoning passthrough
# ---------------------------------------------------------------------------


def _parse_sse_data(line: str) -> dict[str, Any] | None:
    """Parse one SSE `data: …` payload line. Returns None for [DONE] / non-data lines."""
    if not line.startswith("data:"):
        return None
    raw = line[5:].strip()
    if not raw or raw == "[DONE]":
        return None
    try:
        return json.loads(raw)  # type: ignore[no-any-return]
    except json.JSONDecodeError:
        return None


def _is_thinking_field_rejection(http_status: int, body_text: str) -> bool:
    """Detect 400 errors specifically about the `thinking` field.

    Triggered by upstream gateways that route to models with vendor-specific
    thinking constraints, e.g.:
      - MiniMax-M2.5 via DashScope coding-plan: rejects `thinking: disabled`
        with "The value of the enable_thinking parameter is restricted to True"
      - Native Anthropic on Claude 3 (non-thinking): rejects `thinking:enabled`
      - Hypothetical proxy: any 400 mentioning the thinking field

    Returns True only on 400 + textual evidence the thinking field is the
    culprit. This is the trigger for an automatic retry without the field —
    we don't blanket-retry every 400 because that would mask real bugs.
    """
    if http_status != 400:
        return False
    text = body_text.lower()
    return "thinking" in text or "enable_thinking" in text


async def _astream_anthropic_chat(
    provider: LLMProvider,
    model_name: str,
    *,
    prompt: str | None,
    messages: list[dict[str, str]] | None,
    system: str | None,
    temperature: float | None,
    top_p: float | None,
    max_tokens: int | None,
    stop: list[str] | None,
    enable_thinking: bool | None,
    http_client: httpx.AsyncClient | None,
) -> AsyncIterator[dict[str, Any]]:
    """Stream an Anthropic Messages API call, emitting the same event
    vocabulary (`meta`/`delta`/`done`/`error`) the OpenAI streamer uses.

    Anthropic's SSE uses typed frames (`message_start`, `content_block_delta`,
    `message_delta`, `message_stop`) — we translate them into unified events
    so upstream consumers (the AG-UI encoder, the Gateway UI) don't have to
    care which wire format a given provider speaks.

    Thinking-field auto-retry (2026-04-25):
      Some upstream model routes have hard constraints on the `thinking`
      field (MiniMax-M2.5 only accepts True; certain Anthropic models reject
      enabled; etc.). If the FIRST attempt 400s with a thinking-related error
      message, we transparently retry once with the thinking field stripped.
      The user gets a clean response without needing to know which models
      have which protocol quirks. A `warning` event is emitted so the
      observability layer can still see what happened.
    """
    sys_text, msgs = _split_system_and_messages(system=system, messages=messages, prompt=prompt)
    body = _build_anthropic_body(
        model_name=model_name,
        system=sys_text,
        messages=msgs,
        temperature=temperature,
        top_p=top_p,
        max_tokens=max_tokens,
        stop=stop,
        stream=True,
        enable_thinking=enable_thinking,
        native_anthropic=_is_native_anthropic_base(provider.base_url),
    )
    url = _anthropic_url(provider)
    started = time.perf_counter()

    yield {"type": "meta", "model": model_name, "started_at_ms": int(started * 1000)}

    client = http_client or httpx.AsyncClient(timeout=120)
    owns_client = http_client is None
    try:
        async for evt in _anthropic_stream_attempt(client, url, provider, body, started):
            # First attempt failed with a thinking-related 400 AND we still
            # carry a `thinking` field → strip it and retry once.
            if (
                evt.get("type") == "error"
                and "thinking" in body
                and isinstance(evt.get("_http_status"), int)
                and _is_thinking_field_rejection(evt["_http_status"], evt.get("_body_text") or "")
            ):
                yield {
                    "type": "warning",
                    "message": t("models.warning.thinking_unsupported"),
                    "category": "thinking_unsupported",
                }
                body_retry = {k: v for k, v in body.items() if k != "thinking"}
                async for retry_evt in _anthropic_stream_attempt(
                    client, url, provider, body_retry, started
                ):
                    # Strip the internal hints before yielding to consumers.
                    cleaned = {
                        k: v
                        for k, v in retry_evt.items()
                        if k not in ("_http_status", "_body_text")
                    }
                    yield cleaned
                return
            # Strip internal hint fields before passing through.
            cleaned = {k: v for k, v in evt.items() if k not in ("_http_status", "_body_text")}
            yield cleaned
    finally:
        if owns_client:
            await client.aclose()


async def _anthropic_stream_attempt(
    client: httpx.AsyncClient,
    url: str,
    provider: LLMProvider,
    body: dict[str, Any],
    started: float,
) -> AsyncIterator[dict[str, Any]]:
    """Single anthropic POST + SSE stream → unified events.

    Returns the same event shapes `_astream_anthropic_chat` yields, but
    additionally tags the error event (when HTTP-level) with `_http_status`
    and `_body_text` so the caller can decide whether to retry. The outer
    function strips those before yielding to its consumers.
    """
    first_content_at: float | None = None
    first_reasoning_at: float | None = None
    content_buf: list[str] = []
    reasoning_buf: list[str] = []
    input_tokens = 0
    output_tokens = 0

    try:
        async with client.stream(
            "POST", url, headers=_anthropic_headers(provider), json=body
        ) as resp:
            if resp.status_code >= 400:
                raw = await resp.aread()
                body_text = raw.decode("utf-8", errors="replace")
                yield {
                    "type": "error",
                    "error": f"HTTP {resp.status_code}: {body_text[:500]}",
                    "error_category": categorize_http_status(resp.status_code),
                    "latency_ms": int((time.perf_counter() - started) * 1000),
                    "_http_status": resp.status_code,
                    "_body_text": body_text,
                }
                return
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if not payload or payload == "[DONE]":
                    continue
                try:
                    data = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                etype = data.get("type")
                if etype == "message_start":
                    u = (data.get("message") or {}).get("usage") or {}
                    input_tokens = int(u.get("input_tokens") or input_tokens)
                    output_tokens = int(u.get("output_tokens") or output_tokens)
                elif etype == "content_block_delta":
                    delta = data.get("delta") or {}
                    # Visible text deltas. Extended thinking models emit
                    # `thinking_delta` separately — treat it as reasoning
                    # so the UI's reasoning panel populates, mirroring
                    # OpenAI-compat reasoning_content behaviour.
                    if delta.get("type") == "text_delta":
                        text = str(delta.get("text") or "")
                        if text:
                            if first_content_at is None:
                                first_content_at = time.perf_counter()
                            content_buf.append(text)
                            yield {"type": "delta", "text": text}
                    elif delta.get("type") == "thinking_delta":
                        text = str(delta.get("thinking") or "")
                        if text:
                            if first_reasoning_at is None:
                                first_reasoning_at = time.perf_counter()
                            reasoning_buf.append(text)
                            yield {"type": "reasoning", "text": text}
                elif etype == "message_delta":
                    u = data.get("usage") or {}
                    # message_delta emits the cumulative output_tokens.
                    if "output_tokens" in u:
                        output_tokens = int(u["output_tokens"])
    except Exception as exc:
        yield {
            "type": "error",
            "error": str(exc),
            "error_category": categorize_error(exc),
            "latency_ms": int((time.perf_counter() - started) * 1000),
        }
        return
    # Note: this helper does NOT own the http client — the outer
    # _astream_anthropic_chat creates and closes it (so retries reuse the
    # same connection pool).

    latency_ms = int((time.perf_counter() - started) * 1000)
    ttft_ms = int((first_content_at - started) * 1000) if first_content_at else latency_ms
    reasoning_first_ms = int((first_reasoning_at - started) * 1000) if first_reasoning_at else 0
    response = "".join(content_buf)
    reasoning_text = "".join(reasoning_buf)
    if first_content_at is not None and output_tokens:
        elapsed_s = max(time.perf_counter() - first_content_at, 1e-6)
        tok_per_sec = round(output_tokens / elapsed_s, 2)
    else:
        tok_per_sec = 0.0

    # IDEALAB / 半 anthropic-compat 反代防御:
    # 流"成功结束"(无 HTTP error · 无 exception)但 content + reasoning
    # 都是空字符串,几乎一定是代理不识别 thinking 字段把整个流吞了。
    # 翻成 error event,告诉用户上游兼容性问题(而不是默默给 0 tokens)。
    if not response and not reasoning_text and output_tokens == 0:
        yield {
            "type": "error",
            "error": t("models.error.empty_response_anthropic_compat"),
            "error_category": "provider_error",
            "latency_ms": latency_ms,
        }
        return

    yield {
        "type": "done",
        "latency_ms": latency_ms,
        "ttft_ms": ttft_ms,
        "reasoning_first_ms": reasoning_first_ms,
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens,
        },
        "tokens_per_second": tok_per_sec,
        "response": response,
        "reasoning_text": reasoning_text,
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
    enable_thinking: bool | None = None,
    http_client: httpx.AsyncClient | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Stream a chat test as a sequence of event dicts.

    Events:
      - {"type": "meta", "model": str, "started_at_ms": int}
      - {"type": "reasoning", "text": str}        ← delta of reasoning_content (thinking models)
      - {"type": "delta", "text": str}             ← delta of content (visible answer)
      - {"type": "done", "latency_ms": int, "ttft_ms": int, "reasoning_first_ms": int,
                         "usage": {...}, "tokens_per_second": float,
                         "response": str, "reasoning_text": str}
      - {"type": "error", "error": str, "error_category": str, "latency_ms": int}

    TTFT semantics (P11 · D3 · 关键数值):
      - `reasoning_first_ms` = time to first reasoning chunk (0 if no reasoning)
      - `ttft_ms`            = time to first **visible content** chunk (what the user waits for)
    """
    if _is_anthropic(provider):
        async for evt in _astream_anthropic_chat(
            provider,
            model_name,
            prompt=prompt,
            messages=messages,
            system=system,
            temperature=temperature,
            top_p=top_p,
            max_tokens=max_tokens,
            stop=stop,
            enable_thinking=enable_thinking,
            http_client=http_client,
        ):
            yield evt
        return
    body = _build_openai_body(
        model_name=model_name,
        messages=_build_openai_messages(system=system, messages=messages, prompt=prompt),
        temperature=temperature,
        top_p=top_p,
        max_tokens=max_tokens,
        stop=stop,
        enable_thinking=enable_thinking,
        stream=True,
    )
    url = _base_url(provider) + "/chat/completions"
    started = time.perf_counter()

    yield {"type": "meta", "model": model_name, "started_at_ms": int(started * 1000)}

    first_content_at: float | None = None
    first_reasoning_at: float | None = None
    content_buf: list[str] = []
    reasoning_buf: list[str] = []
    usage: dict[str, Any] = {}

    client = http_client or httpx.AsyncClient(timeout=120)
    owns_client = http_client is None
    try:
        try:
            async with client.stream("POST", url, headers=_headers(provider), json=body) as resp:
                if resp.status_code >= 400:
                    raw = await resp.aread()
                    yield {
                        "type": "error",
                        "error": f"HTTP {resp.status_code}: {raw.decode('utf-8', errors='replace')[:500]}",
                        "error_category": categorize_http_status(resp.status_code),
                        "latency_ms": int((time.perf_counter() - started) * 1000),
                    }
                    return
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    data = _parse_sse_data(line)
                    if data is None:
                        continue
                    # usage can arrive on the last chunk (stream_options.include_usage)
                    u = data.get("usage")
                    if u:
                        usage = u
                    choices = data.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    rc = delta.get("reasoning_content")
                    if rc:
                        if first_reasoning_at is None:
                            first_reasoning_at = time.perf_counter()
                        reasoning_buf.append(str(rc))
                        yield {"type": "reasoning", "text": str(rc)}
                    c = delta.get("content")
                    if c:
                        if first_content_at is None:
                            first_content_at = time.perf_counter()
                        content_buf.append(str(c))
                        yield {"type": "delta", "text": str(c)}
        except Exception as exc:
            yield {
                "type": "error",
                "error": str(exc),
                "error_category": categorize_error(exc),
                "latency_ms": int((time.perf_counter() - started) * 1000),
            }
            return
    finally:
        if owns_client:
            await client.aclose()

    latency_ms = int((time.perf_counter() - started) * 1000)
    ttft_ms = int((first_content_at - started) * 1000) if first_content_at else latency_ms
    reasoning_first_ms = int((first_reasoning_at - started) * 1000) if first_reasoning_at else 0
    response = "".join(content_buf)
    reasoning_text = "".join(reasoning_buf)
    output_tokens = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
    # tok/s over the whole streaming phase — divide total output tokens (which
    # include reasoning on thinking models) by elapsed time from first chunk
    # (reasoning or content) to the terminal done. Dividing by the content-only
    # window would inflate tok/s to ~6000 for models that finalize in <50 ms
    # after a multi-second reasoning phase.
    stream_start = first_reasoning_at or first_content_at
    if stream_start is not None and output_tokens:
        elapsed_s = max(time.perf_counter() - stream_start, 1e-6)
        tok_per_sec = round(output_tokens / elapsed_s, 2)
    else:
        tok_per_sec = 0.0

    yield {
        "type": "done",
        "latency_ms": latency_ms,
        "ttft_ms": ttft_ms,
        "reasoning_first_ms": reasoning_first_ms,
        "usage": {
            "input_tokens": int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0),
            "output_tokens": output_tokens,
            "total_tokens": int(usage.get("total_tokens") or 0),
        },
        "tokens_per_second": tok_per_sec,
        "response": response,
        "reasoning_text": reasoning_text,
    }
