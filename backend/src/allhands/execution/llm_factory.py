"""LangChain chat-model factory dispatched by `LLMProvider.kind`.

- openai / aliyun → ChatOpenAI (OpenAI-compatible HTTP + SSE)
- anthropic → ChatAnthropic (Messages API · x-api-key + anthropic-version)

Kept at the `execution/` layer per the L01 layering contract: services
call this to materialize an LLM without knowing the adapter details;
routers (providers.test_connection / ping) reuse it too.
"""

from __future__ import annotations

from typing import Any

from allhands.core.provider import LLMProvider


def resolve_model_name(provider: LLMProvider, model_ref: str) -> str:
    """Pick the concrete model name to send upstream.

    Rules:
      1. Bare name (no slash) → pass through.
      2. ``{prefix}/{name}`` whose prefix matches this provider's ``name``
         (case-insensitive) or ``kind`` → strip prefix, send ``name``.
      3. Mismatched prefix + ``kind == "openai"`` → pass the full ref through.
         OpenRouter/DeepSeek aggregators use slashes as routing (e.g.
         ``anthropic/claude-3``); we can't tell them apart from bare OpenAI
         at the kind level, so we err on the side of preserving intent.
      4. Mismatched prefix + other kinds (``anthropic`` / ``aliyun``) → pass
         through; upstream will reject if it isn't real, which is the right
         signal to the user. We used to fall back to ``provider.default_model``
         here, but that field is gone — defaulting is now the caller's job
         (``model_resolution.resolve_effective_model`` always returns a
         resolvable ref before reaching this layer).
      5. Empty ref → return empty; upstream LangChain ctor will validate.
         Callers shouldn't pass empty refs in the new flow, but we keep the
         function total to avoid surprise exceptions on the hot path.
    """
    if not model_ref:
        return ""
    if "/" not in model_ref:
        return model_ref
    prefix, name = model_ref.split("/", 1)
    if prefix.lower() == provider.name.lower() or prefix.lower() == provider.kind:
        return name
    return model_ref


def build_llm(
    provider: LLMProvider,
    model_ref: str,
    *,
    thinking: bool | None = None,
    max_output_tokens: int | None = None,
) -> Any:
    """Return a LangChain BaseChatModel bound to `provider` + `model_ref`.

    `model_ref` may be bare (``"gpt-4o-mini"``) or a ``provider/model``
    composite — see ``resolve_model_name`` for the matching rules. This
    function just picks the right LangChain adapter by ``provider.kind``.

    ``thinking`` is the per-turn reasoning toggle (E18):
    ``langchain_anthropic.ChatAnthropic.thinking`` is a Pydantic ctor field
    that is read once at request-payload build time — ``.bind(thinking=...)``
    does NOT propagate (we tried; 146 reasoning chunks still streamed for
    a ``thinking=False`` user click). The only reliable wire is to bake it
    into the constructor. For OpenAI-compat adapters the caller keeps using
    ``.bind(extra_body={"enable_thinking": bool})`` — that path works
    because ``extra_body`` is a call-time pass-through.

    Contract:
      - ``thinking`` None → don't set anything, inherit provider default
      - ``thinking`` bool + anthropic kind → baked into ctor
      - ``thinking`` bool + openai kind → handled by caller via bind
    """
    model_name = resolve_model_name(provider, model_ref)

    if provider.kind == "anthropic":
        from langchain_anthropic import ChatAnthropic

        kwargs: dict[str, Any] = {"model": model_name}
        if provider.api_key:
            kwargs["api_key"] = provider.api_key
        if provider.base_url:
            kwargs["base_url"] = provider.base_url
        if thinking is not None:
            # budget_tokens must be ≥ 1024 when enabled (Anthropic Messages
            # API rejects smaller). 8000 is a safe default that won't eat
            # the full max_tokens window. DashScope's anthropic-compat
            # proxy honours the same shape.
            kwargs["thinking"] = (
                {"type": "enabled", "budget_tokens": 8000} if thinking else {"type": "disabled"}
            )
        if max_output_tokens is not None:
            # ChatAnthropic's `max_tokens` is also ctor-time only — bind() does
            # not propagate to the request payload, mirroring `thinking`.
            kwargs["max_tokens"] = max_output_tokens
        return ChatAnthropic(**kwargs)

    from langchain_openai import ChatOpenAI

    kwargs = {"model": model_name}
    if provider.api_key:
        kwargs["api_key"] = provider.api_key
    if provider.base_url:
        kwargs["base_url"] = provider.base_url
    if max_output_tokens is not None:
        kwargs["max_tokens"] = max_output_tokens
    # 2026-04-28 token-bug fix · OpenAI streaming responses do NOT carry
    # ``usage`` chunks unless the request opts in via ``stream_options=
    # {"include_usage": True}``. Without this flag, ``AIMessageChunk
    # .usage_metadata`` stays empty for *every* streaming call, agent_loop
    # records (0, 0, 0) into ``LLMCallFinished``, the run.completed event
    # also writes zeros, and the observatory shows "—" cost forever.
    # ``stream_usage=True`` (langchain-openai ≥ 0.1.16) translates to the
    # right ``stream_options`` on the wire AND is also honored by all the
    # OpenAI-compat gateways we route through ChatOpenAI (DashScope /
    # 百炼 / DeepSeek / Kimi etc · ignore unknown extra opts gracefully).
    kwargs["stream_usage"] = True
    return ChatOpenAI(**kwargs)


def probe_endpoint(provider: LLMProvider) -> tuple[str, dict[str, str]]:
    """Return ``(url, headers)`` for a connectivity probe that lists models.

    Used by `/providers/:id/test` and meta tool ``test_provider_connection``.
    The idea is "can I reach this provider's models endpoint with this key?" —
    cheaper than a chat completion, and the failure mode maps cleanly to
    401 (bad key) / 404 (bad URL) / 5xx (upstream down).
    """
    if provider.kind == "anthropic":
        # Anthropic's list-models endpoint lives at /v1/models. Some deployments
        # of the compat proxy strip the /v1 prefix, so append it defensively.
        base = provider.base_url.rstrip("/")
        url = base + "/v1/models" if not base.endswith("/v1") else base + "/models"
        headers = {"anthropic-version": "2023-06-01"}
        if provider.api_key:
            headers["x-api-key"] = provider.api_key
        return url, headers

    url = provider.base_url.rstrip("/") + "/models"
    headers = {"Authorization": f"Bearer {provider.api_key}"} if provider.api_key else {}
    return url, headers
