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
      4. Mismatched prefix + other kinds (``anthropic`` / ``aliyun``) → the
         ref was meant for a different provider that is no longer bound;
         fall back to ``provider.default_model`` rather than sending an
         unknown model to an upstream that doesn't do slash routing.
      5. Empty / missing ref → fall back to ``provider.default_model``.
         Seeds may leave ``model_ref`` blank to pick up whatever the
         currently bound provider recommends.
    """
    if not model_ref:
        return provider.default_model
    if "/" not in model_ref:
        return model_ref
    prefix, name = model_ref.split("/", 1)
    if prefix.lower() == provider.name.lower() or prefix.lower() == provider.kind:
        return name
    if provider.kind == "openai":
        return model_ref
    return provider.default_model


def build_llm(provider: LLMProvider, model_ref: str) -> Any:
    """Return a LangChain BaseChatModel bound to `provider` + `model_ref`.

    `model_ref` may be bare (``"gpt-4o-mini"``) or a ``provider/model``
    composite — see ``resolve_model_name`` for the matching rules. This
    function just picks the right LangChain adapter by ``provider.kind``.
    """
    model_name = resolve_model_name(provider, model_ref)

    if provider.kind == "anthropic":
        from langchain_anthropic import ChatAnthropic

        kwargs: dict[str, Any] = {"model": model_name}
        if provider.api_key:
            kwargs["api_key"] = provider.api_key
        if provider.base_url:
            kwargs["base_url"] = provider.base_url
        return ChatAnthropic(**kwargs)

    from langchain_openai import ChatOpenAI

    kwargs = {"model": model_name}
    if provider.api_key:
        kwargs["api_key"] = provider.api_key
    if provider.base_url:
        kwargs["base_url"] = provider.base_url
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
