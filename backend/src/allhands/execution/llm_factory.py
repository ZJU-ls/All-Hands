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


def build_llm(provider: LLMProvider, model_ref: str) -> Any:
    """Return a LangChain BaseChatModel bound to `provider` + `model_ref`.

    `model_ref` may be either a bare model name (``"gpt-4o-mini"``) or a
    ``provider/model`` composite — we split on the last slash *only* when
    the composite shape is intentional (legacy quirks). Anthropic model
    names contain dots, not slashes, so this is safe for all 3 kinds.
    """
    model_name = model_ref.split("/", 1)[-1] if "/" in model_ref else model_ref

    if provider.kind == "anthropic":
        from langchain_anthropic import ChatAnthropic

        kwargs: dict[str, Any] = {"model": model_name}
        if provider.api_key:
            kwargs["api_key"] = provider.api_key
        if provider.base_url:
            kwargs["base_url"] = provider.base_url
        return ChatAnthropic(**kwargs)

    # openai + aliyun (DashScope compatible-mode) share the OpenAI wire format.
    from langchain_openai import ChatOpenAI

    kwargs = {"model": model_ref if provider.kind == "openai" and "/" in model_ref else model_name}
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
