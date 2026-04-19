"""Unit tests for model_service chat-test helpers (P11 · D3/D4).

Covers:
  - categorize_error → canonical UI categories
  - _build_messages / _llm_kwargs → correct LangChain payloads
  - run_chat_test → shape of ok and error results (LLM monkeypatched)
  - astream_chat_test → event sequence (LLM monkeypatched)
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from allhands.core.provider import LLMProvider
from allhands.services.model_service import (
    _build_messages,
    _llm_kwargs,
    astream_chat_test,
    categorize_error,
    run_chat_test,
)


def _provider() -> LLMProvider:
    return LLMProvider(
        id="p1",
        name="TestProvider",
        base_url="https://api.example.com/v1",
        api_key="sk-fake",
        default_model="gpt-4o-mini",
        is_default=True,
    )


# ---------------- categorize_error ----------------


class _FakeTimeout(Exception):
    pass


@pytest.mark.parametrize(
    ("msg", "expected"),
    [
        ("Request timed out", "timeout"),
        ("Invalid API key provided", "auth"),
        ("HTTP 401 Unauthorized", "auth"),
        ("Rate limit reached", "rate_limit"),
        ("HTTP 429 Too Many Requests", "rate_limit"),
        ("The model gpt-42 does not exist", "model_not_found"),
        ("maximum context length is 8192", "context_length"),
        ("ConnectionError: nodename nor servname provided", "connection"),
        ("upstream returned HTTP 503 status", "provider_error"),
        ("surprise", "unknown"),
    ],
)
def test_categorize_error(msg: str, expected: str) -> None:
    assert categorize_error(Exception(msg)) == expected


def test_categorize_error_uses_exception_class_name() -> None:
    assert categorize_error(TimeoutError("boom")) == "timeout"


# ---------------- _build_messages ----------------


def test_build_messages_prefers_messages_over_prompt() -> None:
    msgs = _build_messages(
        system="be brief",
        messages=[
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "ok"},
            {"role": "user", "content": "more?"},
        ],
        prompt="should be ignored",
    )
    # 1 system + 3 conversation
    assert len(msgs) == 4
    assert msgs[0].content == "be brief"
    assert msgs[1].content == "hi"
    assert msgs[2].content == "ok"
    assert msgs[3].content == "more?"


def test_build_messages_falls_back_to_prompt() -> None:
    msgs = _build_messages(system=None, messages=None, prompt="ping")
    assert len(msgs) == 1
    assert msgs[0].content == "ping"


# ---------------- _llm_kwargs ----------------


def test_llm_kwargs_only_includes_non_none_fields() -> None:
    kwargs = _llm_kwargs(
        _provider(),
        "gpt-4o-mini",
        temperature=None,
        top_p=None,
        max_tokens=None,
        stop=None,
    )
    assert kwargs == {
        "model": "gpt-4o-mini",
        "api_key": "sk-fake",
        "base_url": "https://api.example.com/v1",
    }


def test_llm_kwargs_includes_sampling_and_stream_usage() -> None:
    kwargs = _llm_kwargs(
        _provider(),
        "gpt-4o-mini",
        temperature=0.2,
        top_p=0.9,
        max_tokens=256,
        stop=["\n\n"],
        stream_usage=True,
    )
    assert kwargs["temperature"] == 0.2
    assert kwargs["top_p"] == 0.9
    assert kwargs["max_tokens"] == 256
    assert kwargs["stop"] == ["\n\n"]
    assert kwargs["stream_usage"] is True


# ---------------- run_chat_test (monkeypatched LLM) ----------------


class _FakeLLM:
    def __init__(self, *, response_text: str = "pong", raise_on: Exception | None = None) -> None:
        self._response_text = response_text
        self._raise_on = raise_on

    async def ainvoke(self, messages: list[Any]) -> Any:
        if self._raise_on is not None:
            raise self._raise_on
        return SimpleNamespace(
            content=self._response_text,
            usage_metadata={"input_tokens": 7, "output_tokens": 3, "total_tokens": 10},
        )


@pytest.mark.asyncio
async def test_run_chat_test_ok_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    import langchain_openai

    monkeypatch.setattr(
        langchain_openai, "ChatOpenAI", lambda **_: _FakeLLM(response_text="pong 👋")
    )
    result = await run_chat_test(_provider(), "gpt-4o-mini", prompt="ping")
    assert result["ok"] is True
    assert result["model"] == "gpt-4o-mini"
    assert result["response"] == "pong 👋"
    assert result["usage"] == {"input_tokens": 7, "output_tokens": 3, "total_tokens": 10}
    assert isinstance(result["latency_ms"], int)
    assert result["latency_ms"] >= 0


@pytest.mark.asyncio
async def test_run_chat_test_error_is_categorized(monkeypatch: pytest.MonkeyPatch) -> None:
    import langchain_openai

    monkeypatch.setattr(
        langchain_openai,
        "ChatOpenAI",
        lambda **_: _FakeLLM(raise_on=Exception("HTTP 429 Too Many Requests")),
    )
    result = await run_chat_test(_provider(), "gpt-4o-mini", prompt="ping")
    assert result["ok"] is False
    assert result["error_category"] == "rate_limit"
    assert "429" in result["error"]
    assert "latency_ms" in result


# ---------------- astream_chat_test ----------------


class _FakeStreamLLM:
    def __init__(self, chunks: list[str], usage: dict[str, int] | None = None) -> None:
        self._chunks = chunks
        self._usage = usage or {"input_tokens": 4, "output_tokens": 5, "total_tokens": 9}

    async def astream(self, messages: list[Any]):
        import asyncio

        last = len(self._chunks) - 1
        for i, chunk in enumerate(self._chunks):
            await asyncio.sleep(0)
            usage_md = self._usage if i == last else None
            yield SimpleNamespace(content=chunk, usage_metadata=usage_md)


@pytest.mark.asyncio
async def test_astream_chat_test_emits_full_event_sequence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import langchain_openai

    monkeypatch.setattr(
        langchain_openai,
        "ChatOpenAI",
        lambda **_: _FakeStreamLLM(["he", "llo", " world"]),
    )
    events = [evt async for evt in astream_chat_test(_provider(), "gpt-4o-mini", prompt="hi")]
    types = [e["type"] for e in events]
    assert types[0] == "meta"
    assert "delta" in types
    assert types[-1] == "done"
    deltas = [e["text"] for e in events if e["type"] == "delta"]
    assert "".join(deltas) == "hello world"
    done = events[-1]
    assert done["response"] == "hello world"
    assert done["usage"]["output_tokens"] == 5
    assert "ttft_ms" in done
    assert "tokens_per_second" in done
