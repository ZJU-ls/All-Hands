"""Unit tests for execution.llm_factory — provider-kind dispatch.

Covers:
  - build_llm returns ChatOpenAI for openai + aliyun, ChatAnthropic for anthropic
  - probe_endpoint produces the right URL + auth-header shape per kind
  - base_url/api_key wiring respects provider fields
"""

from __future__ import annotations

from allhands.core.provider import LLMProvider
from allhands.execution.llm_factory import build_llm, probe_endpoint, resolve_model_name


def _p(
    *,
    kind: str,
    base_url: str,
    api_key: str = "sk-fake",
    default_model: str = "m",  # kept for back-compat with old tests; unused
) -> LLMProvider:
    del default_model
    return LLMProvider(
        id="p1",
        name="T",
        kind=kind,  # type: ignore[arg-type]
        base_url=base_url,
        api_key=api_key,
    )


def test_build_llm_dispatches_anthropic_kind_to_chat_anthropic() -> None:
    from langchain_anthropic import ChatAnthropic

    provider = _p(
        kind="anthropic",
        base_url="https://api.anthropic.com",
    )
    llm = build_llm(provider, "claude-3-5-sonnet-latest")
    assert isinstance(llm, ChatAnthropic)


def test_build_llm_dispatches_openai_kind_to_chat_openai() -> None:
    from langchain_openai import ChatOpenAI

    provider = _p(kind="openai", base_url="https://api.openai.com/v1")
    llm = build_llm(provider, "gpt-4o-mini")
    assert isinstance(llm, ChatOpenAI)


def test_build_llm_dispatches_aliyun_kind_to_chat_openai() -> None:
    """DashScope compatible-mode speaks the OpenAI wire format."""
    from langchain_openai import ChatOpenAI

    provider = _p(
        kind="aliyun",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
    )
    llm = build_llm(provider, "qwen-plus")
    assert isinstance(llm, ChatOpenAI)


def test_probe_endpoint_openai_hits_models_with_bearer() -> None:
    provider = _p(kind="openai", base_url="https://api.openai.com/v1")
    url, headers = probe_endpoint(provider)
    assert url == "https://api.openai.com/v1/models"
    assert headers["Authorization"] == "Bearer sk-fake"
    # No Anthropic-only headers leak into OpenAI probes.
    assert "anthropic-version" not in headers
    assert "x-api-key" not in headers


def test_probe_endpoint_aliyun_matches_openai_shape() -> None:
    provider = _p(
        kind="aliyun",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
    )
    url, headers = probe_endpoint(provider)
    assert url == "https://dashscope.aliyuncs.com/compatible-mode/v1/models"
    assert headers["Authorization"].startswith("Bearer ")


def test_probe_endpoint_anthropic_sends_xapi_key_and_version() -> None:
    provider = _p(kind="anthropic", base_url="https://api.anthropic.com")
    url, headers = probe_endpoint(provider)
    # Anthropic native root → /v1/models appended.
    assert url == "https://api.anthropic.com/v1/models"
    assert headers["x-api-key"] == "sk-fake"
    assert headers["anthropic-version"] == "2023-06-01"
    # Bearer must NOT be used for Anthropic native.
    assert "Authorization" not in headers


def test_probe_endpoint_anthropic_when_base_already_has_v1() -> None:
    provider = _p(kind="anthropic", base_url="https://proxy.example.com/v1")
    url, _ = probe_endpoint(provider)
    # Should not double-prepend /v1.
    assert url == "https://proxy.example.com/v1/models"


def test_probe_endpoint_openai_no_api_key_omits_auth_header() -> None:
    """Local deployments (Ollama, vLLM) frequently run without an API key."""
    provider = _p(kind="openai", base_url="http://localhost:11434/v1", api_key="")
    url, headers = probe_endpoint(provider)
    assert url == "http://localhost:11434/v1/models"
    assert "Authorization" not in headers


# --- E18 regression · per-turn thinking override must hit the wire ---------
#
# First attempt (2026-04-21) only handled OpenAI-compat `extra_body` and relied
# on `.bind(thinking=...)` for anthropic kind. Verified via curl: user clicked
# the grey "深度思考" button, sent a message, and the SSE stream still carried
# 146 REASONING_MESSAGE_CHUNK frames. Root cause: `ChatAnthropic.thinking` is a
# Pydantic ctor field consumed at `_get_request_payload` time — `.bind()`
# kwargs land on a RunnableBinding and never reach the payload. Fix: bake
# `thinking={"type": "disabled"|"enabled", "budget_tokens": 8000}` into the
# ChatAnthropic constructor via `build_llm(thinking=...)`.


def test_build_llm_anthropic_bakes_thinking_disabled_into_ctor() -> None:
    provider = _p(
        kind="anthropic",
        base_url="https://coding.dashscope.aliyuncs.com/apps/anthropic",
    )
    llm = build_llm(provider, "qwen3.6-plus", thinking=False)
    assert getattr(llm, "thinking", None) == {"type": "disabled"}


def test_build_llm_anthropic_bakes_thinking_enabled_with_budget() -> None:
    provider = _p(kind="anthropic", base_url="https://api.anthropic.com")
    llm = build_llm(provider, "claude-3-5-sonnet-latest", thinking=True)
    thinking = getattr(llm, "thinking", None)
    assert isinstance(thinking, dict)
    assert thinking["type"] == "enabled"
    # Anthropic API rejects budget_tokens < 1024; the factory must default to
    # a safe value.
    assert thinking["budget_tokens"] >= 1024


def test_build_llm_anthropic_thinking_none_leaves_field_default() -> None:
    """thinking=None → caller didn't express a preference → inherit default."""
    provider = _p(kind="anthropic", base_url="https://api.anthropic.com")
    llm = build_llm(provider, "claude-3-5-sonnet-latest", thinking=None)
    # langchain_anthropic default is None (= provider default wins).
    assert getattr(llm, "thinking", None) is None


def test_build_llm_openai_ignores_thinking_arg() -> None:
    """OpenAI-compat adapters handle thinking via `.bind(extra_body=...)` at
    the runner layer — the factory itself should NOT inject anything into the
    ChatOpenAI ctor, otherwise langchain_openai will warn / error on unknown
    kwargs.
    """
    from langchain_openai import ChatOpenAI

    provider = _p(kind="openai", base_url="https://api.openai.com/v1")
    llm = build_llm(provider, "gpt-4o-mini", thinking=False)
    assert isinstance(llm, ChatOpenAI)
    # No `thinking` field baked into the OpenAI adapter — that's handled by
    # runner._bind_thinking for this kind.
    assert not hasattr(llm, "thinking") or getattr(llm, "thinking", None) is None


# --- resolve_model_name --------------------------------------------------


def _provider(*, kind: str, name: str = "T") -> LLMProvider:
    return LLMProvider(
        id="p1",
        name=name,
        kind=kind,  # type: ignore[arg-type]
        base_url="http://x",
        api_key="sk",
    )


def test_resolve_bare_name_passes_through() -> None:
    p = _provider(kind="openai")
    assert resolve_model_name(p, "gpt-4o-mini") == "gpt-4o-mini"


def test_resolve_prefix_matching_kind_is_stripped() -> None:
    p = _provider(kind="anthropic")
    assert resolve_model_name(p, "anthropic/claude-3") == "claude-3"


def test_resolve_prefix_matching_provider_name_is_stripped_case_insensitive() -> None:
    p = _provider(kind="aliyun", name="DashScope")
    assert resolve_model_name(p, "dashscope/qwen-plus") == "qwen-plus"


def test_resolve_mismatched_prefix_passes_through_aliyun() -> None:
    """Pre-2026-04-25 we used to fall back to provider.default_model on a
    mismatched prefix. That field is gone — defaulting is now the
    resolver's job. The factory just passes the ref through; the upstream
    will tell the caller if the ref is bogus.
    """
    p = _provider(kind="aliyun", name="CodingPlan")
    assert resolve_model_name(p, "bailian/qwen-plus") == "bailian/qwen-plus"


def test_resolve_mismatched_prefix_passes_through_anthropic() -> None:
    p = _provider(kind="anthropic", name="Anthropic")
    assert resolve_model_name(p, "deepseek/deepseek-coder") == "deepseek/deepseek-coder"


def test_resolve_mismatched_prefix_on_openai_passes_through_for_aggregator_routing() -> None:
    """OpenRouter/DeepSeek aggregators use slashes as routing — don't strip."""
    p = _provider(kind="openai", name="OpenRouter")
    assert resolve_model_name(p, "anthropic/claude-3") == "anthropic/claude-3"


def test_resolve_prefix_matching_openai_kind_is_stripped() -> None:
    p = _provider(kind="openai", name="OpenAI")
    assert resolve_model_name(p, "openai/gpt-4o-mini") == "gpt-4o-mini"


def test_resolve_empty_ref_returns_empty() -> None:
    """`provider.default_model` is gone — empty in, empty out. Callers
    are expected to never pass empty strings now (model_resolution
    guarantees a real ref)."""
    p = _provider(kind="aliyun")
    assert resolve_model_name(p, "") == ""
