"""Unit tests for model_service chat-test helpers (P11 · D3/D4).

Covers:
  - categorize_error / categorize_http_status → canonical UI categories
  - _build_openai_messages / _build_openai_body → correct OpenAI payloads
  - run_chat_test → shape of ok and error results (httpx.MockTransport)
  - astream_chat_test → reasoning + delta + done event sequence (httpx.MockTransport)
  - enable_thinking propagation end-to-end
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from allhands.core.provider import LLMProvider
from allhands.services.model_service import (
    _build_openai_body,
    _build_openai_messages,
    astream_chat_test,
    categorize_error,
    categorize_http_status,
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


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (401, "auth"),
        (403, "auth"),
        (404, "model_not_found"),
        (408, "timeout"),
        (429, "rate_limit"),
        (500, "provider_error"),
        (502, "provider_error"),
        (504, "timeout"),
        (418, "unknown"),
    ],
)
def test_categorize_http_status(status: int, expected: str) -> None:
    assert categorize_http_status(status) == expected


# ---------------- _build_openai_messages ----------------


def test_build_openai_messages_prefers_messages_over_prompt() -> None:
    msgs = _build_openai_messages(
        system="be brief",
        messages=[
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "ok"},
            {"role": "user", "content": "more?"},
        ],
        prompt="should be ignored",
    )
    assert msgs == [
        {"role": "system", "content": "be brief"},
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "ok"},
        {"role": "user", "content": "more?"},
    ]


def test_build_openai_messages_falls_back_to_prompt() -> None:
    msgs = _build_openai_messages(system=None, messages=None, prompt="ping")
    assert msgs == [{"role": "user", "content": "ping"}]


def test_build_openai_messages_rejects_bad_role() -> None:
    msgs = _build_openai_messages(
        system=None,
        messages=[{"role": "tool", "content": "ignored role"}],
        prompt=None,
    )
    assert msgs == [{"role": "user", "content": "ignored role"}]


# ---------------- _build_openai_body ----------------


def test_build_openai_body_omits_none_fields() -> None:
    body = _build_openai_body(
        model_name="m",
        messages=[{"role": "user", "content": "hi"}],
        temperature=None,
        top_p=None,
        max_tokens=None,
        stop=None,
        enable_thinking=None,
        stream=False,
    )
    assert body == {"model": "m", "messages": [{"role": "user", "content": "hi"}]}


def test_build_openai_body_includes_enable_thinking_stream_options() -> None:
    body = _build_openai_body(
        model_name="m",
        messages=[{"role": "user", "content": "hi"}],
        temperature=0.7,
        top_p=0.9,
        max_tokens=64,
        stop=["\n\n"],
        enable_thinking=True,
        stream=True,
    )
    assert body["temperature"] == 0.7
    assert body["top_p"] == 0.9
    assert body["max_tokens"] == 64
    assert body["stop"] == ["\n\n"]
    assert body["enable_thinking"] is True
    assert body["stream"] is True
    assert body["stream_options"] == {"include_usage": True}


# ---------------- run_chat_test (httpx.MockTransport) ----------------


def _ok_handler(reasoning: str = "", content: str = "pong 👋") -> Any:
    def handler(request: httpx.Request) -> httpx.Response:
        data = json.loads(request.content)
        assert data["model"] == "gpt-4o-mini"
        # the messages array must round-trip
        assert isinstance(data["messages"], list)
        msg: dict[str, Any] = {"role": "assistant", "content": content}
        if reasoning:
            msg["reasoning_content"] = reasoning
        return httpx.Response(
            200,
            json={
                "choices": [{"message": msg}],
                "usage": {"prompt_tokens": 7, "completion_tokens": 3, "total_tokens": 10},
            },
        )

    return handler


@pytest.mark.asyncio
async def test_run_chat_test_ok_shape() -> None:
    transport = httpx.MockTransport(_ok_handler())
    async with httpx.AsyncClient(transport=transport) as client:
        result = await run_chat_test(_provider(), "gpt-4o-mini", prompt="ping", http_client=client)
    assert result["ok"] is True
    assert result["model"] == "gpt-4o-mini"
    assert result["response"] == "pong 👋"
    assert result["reasoning_text"] == ""
    assert result["usage"] == {"input_tokens": 7, "output_tokens": 3, "total_tokens": 10}
    assert isinstance(result["latency_ms"], int)


@pytest.mark.asyncio
async def test_run_chat_test_preserves_reasoning_text() -> None:
    transport = httpx.MockTransport(
        _ok_handler(reasoning="first I considered X…", content="final answer: 2")
    )
    async with httpx.AsyncClient(transport=transport) as client:
        result = await run_chat_test(_provider(), "gpt-4o-mini", prompt="1+1?", http_client=client)
    assert result["response"] == "final answer: 2"
    assert result["reasoning_text"] == "first I considered X…"


@pytest.mark.asyncio
async def test_run_chat_test_propagates_enable_thinking_to_body() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"role": "assistant", "content": "ok"}}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        await run_chat_test(
            _provider(),
            "m",
            prompt="ping",
            enable_thinking=False,
            http_client=client,
        )
    assert seen.get("enable_thinking") is False


@pytest.mark.asyncio
async def test_run_chat_test_error_is_categorized_by_status() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(429, text="Too Many Requests")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        result = await run_chat_test(_provider(), "gpt-4o-mini", prompt="ping", http_client=client)
    assert result["ok"] is False
    assert result["error_category"] == "rate_limit"
    assert "429" in result["error"]


@pytest.mark.asyncio
async def test_run_chat_test_error_is_categorized_by_exception() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("ECONNREFUSED")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        result = await run_chat_test(_provider(), "gpt-4o-mini", prompt="ping", http_client=client)
    assert result["ok"] is False
    assert result["error_category"] == "connection"


# ---------------- astream_chat_test (httpx.MockTransport) ----------------


def _sse_bytes(chunks: list[dict[str, Any]], include_usage_on_last: bool = True) -> bytes:
    """Serialize a list of OpenAI-compat SSE chunks into raw bytes."""
    lines: list[str] = []
    for i, c in enumerate(chunks):
        if include_usage_on_last and i == len(chunks) - 1:
            c = {
                **c,
                "usage": {"prompt_tokens": 4, "completion_tokens": 5, "total_tokens": 9},
            }
        lines.append(f"data: {json.dumps(c)}\n\n")
    lines.append("data: [DONE]\n\n")
    return "".join(lines).encode()


def _sse_handler(chunks: list[dict[str, Any]]) -> Any:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=_sse_bytes(chunks),
            headers={"Content-Type": "text/event-stream"},
        )

    return handler


def _chunk(content: str | None = None, reasoning: str | None = None) -> dict[str, Any]:
    delta: dict[str, Any] = {}
    if content is not None:
        delta["content"] = content
    if reasoning is not None:
        delta["reasoning_content"] = reasoning
    return {"choices": [{"delta": delta}]}


@pytest.mark.asyncio
async def test_astream_chat_test_emits_full_event_sequence() -> None:
    transport = httpx.MockTransport(
        _sse_handler([_chunk(content="he"), _chunk(content="llo"), _chunk(content=" world")])
    )
    async with httpx.AsyncClient(transport=transport) as client:
        events = [
            e
            async for e in astream_chat_test(
                _provider(), "gpt-4o-mini", prompt="hi", http_client=client
            )
        ]
    types = [e["type"] for e in events]
    assert types[0] == "meta"
    assert types[-1] == "done"
    deltas = [e["text"] for e in events if e["type"] == "delta"]
    assert "".join(deltas) == "hello world"
    done = events[-1]
    assert done["response"] == "hello world"
    assert done["reasoning_text"] == ""
    assert done["usage"]["output_tokens"] == 5
    assert "ttft_ms" in done
    assert "reasoning_first_ms" in done
    assert done["reasoning_first_ms"] == 0  # no reasoning in this run
    assert "tokens_per_second" in done


@pytest.mark.asyncio
async def test_astream_chat_test_emits_reasoning_events_before_content() -> None:
    """P11 · D4 — thinking models must stream reasoning_content separately.

    This is the regression guard for L03 debt 4: without a dedicated
    `reasoning` event the user sees 17s of silence followed by a paste.
    """
    transport = httpx.MockTransport(
        _sse_handler(
            [
                _chunk(reasoning="First I'll "),
                _chunk(reasoning="consider the problem…"),
                _chunk(content="2"),
            ]
        )
    )
    async with httpx.AsyncClient(transport=transport) as client:
        events = [
            e async for e in astream_chat_test(_provider(), "m", prompt="1+1?", http_client=client)
        ]
    types = [e["type"] for e in events]
    # reasoning events arrive before delta events
    first_reasoning = types.index("reasoning")
    first_delta = types.index("delta")
    assert first_reasoning < first_delta
    reasoning_texts = [e["text"] for e in events if e["type"] == "reasoning"]
    assert "".join(reasoning_texts) == "First I'll consider the problem…"
    done = events[-1]
    assert done["type"] == "done"
    assert done["response"] == "2"
    assert done["reasoning_text"] == "First I'll consider the problem…"
    # reasoning_first_ms should be populated (>=0) when reasoning arrived
    assert done["reasoning_first_ms"] >= 0
    # ttft_ms is time to first VISIBLE content, not first reasoning
    assert done["ttft_ms"] >= done["reasoning_first_ms"]
    # tok/s must divide over the FULL streaming window (reasoning+content),
    # not the content-only window — otherwise reasoning-heavy models with a
    # 1-token final answer yield absurd 6000+ tok/s values. We can't assert
    # an absolute upper bound here because httpx.MockTransport returns
    # synchronously (elapsed ≈ microseconds); live curl with the real 2.3 s
    # reasoning phase yields ~75 tok/s which is what the UI now shows.
    assert done["tokens_per_second"] >= 0.0


@pytest.mark.asyncio
async def test_astream_chat_test_propagates_enable_thinking() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(json.loads(request.content))
        return httpx.Response(
            200,
            content=_sse_bytes([_chunk(content="ok")]),
            headers={"Content-Type": "text/event-stream"},
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        events = [
            e
            async for e in astream_chat_test(
                _provider(),
                "m",
                prompt="ping",
                enable_thinking=True,
                http_client=client,
            )
        ]
    assert seen["enable_thinking"] is True
    assert seen["stream"] is True
    assert seen["stream_options"] == {"include_usage": True}
    # and the stream still completes normally
    assert events[-1]["type"] == "done"


@pytest.mark.asyncio
async def test_astream_chat_test_emits_error_event_on_4xx() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="Unauthorized")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        events = [
            e async for e in astream_chat_test(_provider(), "m", prompt="ping", http_client=client)
        ]
    # meta then error, nothing else
    types = [e["type"] for e in events]
    assert types == ["meta", "error"]
    assert events[1]["error_category"] == "auth"
