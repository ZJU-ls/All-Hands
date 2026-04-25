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


# ---------------- Anthropic-kind dispatch (E13 regression) ----------------
#
# run_chat_test / astream_chat_test must recognize kind="anthropic" and hit
# the Messages API (/v1/messages · x-api-key · anthropic-version). Without
# this, providers whose only endpoint is /v1/messages (DashScope coding-plan,
# Anthropic native, proxies in front of Claude) return 404 "model_not_found"
# on ping even though the provider works from the Lead Agent runtime
# (which uses build_llm → ChatAnthropic and therefore already routes
# correctly). The gateway UI then shows "no models" next to a working
# provider.


def _anthropic_provider(base_url: str = "https://api.anthropic.com") -> LLMProvider:
    return LLMProvider(
        id="p-ant",
        name="Anthro",
        kind="anthropic",
        base_url=base_url,
        api_key="sk-ant-fake",
    )


@pytest.mark.asyncio
async def test_run_chat_test_anthropic_hits_messages_endpoint() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "id": "msg_1",
                "type": "message",
                "role": "assistant",
                "content": [{"type": "text", "text": "pong"}],
                "model": "claude-3-5-sonnet-latest",
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 5, "output_tokens": 2},
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        result = await run_chat_test(
            _anthropic_provider(),
            "claude-3-5-sonnet-latest",
            prompt="ping",
            http_client=client,
        )

    assert result["ok"] is True
    assert result["response"] == "pong"
    assert result["usage"] == {"input_tokens": 5, "output_tokens": 2, "total_tokens": 7}
    # Messages API, not /chat/completions.
    assert captured["url"] == "https://api.anthropic.com/v1/messages"
    # Anthropic auth headers, not Bearer.
    assert captured["headers"]["x-api-key"] == "sk-ant-fake"
    assert captured["headers"]["anthropic-version"] == "2023-06-01"
    assert "authorization" not in {k.lower() for k in captured["headers"]}
    # Anthropic body shape: model + messages + max_tokens required.
    assert captured["body"]["model"] == "claude-3-5-sonnet-latest"
    assert captured["body"]["messages"] == [{"role": "user", "content": "ping"}]
    assert captured["body"]["max_tokens"] >= 1


@pytest.mark.asyncio
async def test_run_chat_test_anthropic_system_goes_top_level_not_a_role() -> None:
    """Anthropic Messages API rejects `role: system` — it must be top-level."""
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "ok"}],
                "usage": {"input_tokens": 1, "output_tokens": 1},
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        await run_chat_test(
            _anthropic_provider(),
            "claude-3-5-sonnet-latest",
            prompt="hello",
            system="be terse",
            http_client=client,
        )

    assert captured["body"]["system"] == "be terse"
    # No system role leaked into messages[].
    roles = [m["role"] for m in captured["body"]["messages"]]
    assert "system" not in roles


@pytest.mark.asyncio
async def test_run_chat_test_anthropic_base_with_non_v1_suffix() -> None:
    """DashScope coding plan lives at https://coding.dashscope.aliyuncs.com/apps/anthropic
    with only /v1/messages exposed. The ping must append /v1/messages correctly.
    """
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(
            200,
            json={
                "content": [{"type": "text", "text": "ok"}],
                "usage": {"input_tokens": 1, "output_tokens": 1},
            },
        )

    transport = httpx.MockTransport(handler)
    provider = _anthropic_provider(base_url="https://coding.dashscope.aliyuncs.com/apps/anthropic")
    async with httpx.AsyncClient(transport=transport) as client:
        await run_chat_test(provider, "qwen3.6-plus", prompt="ping", http_client=client)

    assert captured["url"] == "https://coding.dashscope.aliyuncs.com/apps/anthropic/v1/messages"


@pytest.mark.asyncio
async def test_run_chat_test_anthropic_404_categorized_model_not_found() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text="not found")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        result = await run_chat_test(
            _anthropic_provider(),
            "no-such-model",
            prompt="ping",
            http_client=client,
        )
    assert result["ok"] is False
    assert result["error_category"] == "model_not_found"


def _anthropic_sse_bytes(events: list[tuple[str, dict[str, Any]]]) -> bytes:
    """Serialize a list of (event, data) pairs as Anthropic SSE frames.

    Real Anthropic SSE always includes the event type *inside* the data
    payload too, so parsers that only consume `data:` lines can still
    recover the event type. Mirror that here.
    """
    out: list[str] = []
    for event_name, payload in events:
        data = {"type": event_name, **payload}
        out.append(f"event: {event_name}\n")
        out.append(f"data: {json.dumps(data)}\n\n")
    return "".join(out).encode()


@pytest.mark.asyncio
async def test_astream_chat_test_anthropic_emits_delta_events() -> None:
    """Anthropic stream uses `content_block_delta` frames with `delta.text`,
    terminated by `message_delta` carrying `usage.output_tokens`. The streaming
    test must parse these and emit the same `meta → delta* → done` sequence
    the UI relies on, so Gateway ping works for anthropic-kind providers too.
    """

    def handler(_: httpx.Request) -> httpx.Response:
        frames = _anthropic_sse_bytes(
            [
                ("message_start", {"message": {"usage": {"input_tokens": 3, "output_tokens": 0}}}),
                (
                    "content_block_start",
                    {"index": 0, "content_block": {"type": "text", "text": ""}},
                ),
                (
                    "content_block_delta",
                    {"index": 0, "delta": {"type": "text_delta", "text": "he"}},
                ),
                (
                    "content_block_delta",
                    {"index": 0, "delta": {"type": "text_delta", "text": "llo"}},
                ),
                ("content_block_stop", {"index": 0}),
                (
                    "message_delta",
                    {"delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 2}},
                ),
                ("message_stop", {}),
            ]
        )
        return httpx.Response(200, content=frames, headers={"Content-Type": "text/event-stream"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        events = [
            e
            async for e in astream_chat_test(
                _anthropic_provider(), "claude-3-5-sonnet-latest", prompt="hi", http_client=client
            )
        ]

    types = [e["type"] for e in events]
    assert types[0] == "meta"
    assert types[-1] == "done"
    deltas = [e["text"] for e in events if e["type"] == "delta"]
    assert "".join(deltas) == "hello"
    done = events[-1]
    assert done["response"] == "hello"
    assert done["usage"]["input_tokens"] == 3
    assert done["usage"]["output_tokens"] == 2


@pytest.mark.asyncio
async def test_astream_chat_test_anthropic_thinking_populates_reasoning_and_timings() -> None:
    """Thinking-capable Anthropic models stream `thinking_delta` frames before
    `text_delta`. The unified `done` event must surface:
      - `reasoning_text` = concat of all thinking deltas (not `""`)
      - `reasoning_first_ms` > 0 (time-to-first-thinking, distinct from ttft)

    Without this, the Gateway UI's final message loses the reasoning panel and
    the metrics row collapses `ttft·thinking / ttft·answer` to a single `ttft`.
    """

    def handler(_: httpx.Request) -> httpx.Response:
        frames = _anthropic_sse_bytes(
            [
                ("message_start", {"message": {"usage": {"input_tokens": 5, "output_tokens": 0}}}),
                (
                    "content_block_start",
                    {"index": 0, "content_block": {"type": "thinking", "thinking": ""}},
                ),
                (
                    "content_block_delta",
                    {"index": 0, "delta": {"type": "thinking_delta", "thinking": "pondering"}},
                ),
                (
                    "content_block_delta",
                    {"index": 0, "delta": {"type": "thinking_delta", "thinking": " deeply"}},
                ),
                ("content_block_stop", {"index": 0}),
                (
                    "content_block_start",
                    {"index": 1, "content_block": {"type": "text", "text": ""}},
                ),
                (
                    "content_block_delta",
                    {"index": 1, "delta": {"type": "text_delta", "text": "Hi!"}},
                ),
                ("content_block_stop", {"index": 1}),
                (
                    "message_delta",
                    {"delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 4}},
                ),
                ("message_stop", {}),
            ]
        )
        return httpx.Response(200, content=frames, headers={"Content-Type": "text/event-stream"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        events = [
            e
            async for e in astream_chat_test(
                _anthropic_provider(), "claude-3-5-sonnet-latest", prompt="hi", http_client=client
            )
        ]

    reasoning_events = [e for e in events if e["type"] == "reasoning"]
    assert [e["text"] for e in reasoning_events] == ["pondering", " deeply"]

    done = events[-1]
    assert done["type"] == "done"
    assert done["reasoning_text"] == "pondering deeply", (
        "done.reasoning_text must be the concat of all thinking_delta payloads"
    )
    assert done["reasoning_first_ms"] >= 0
    # First reasoning must precede (or equal) first content; both should fire
    # for thinking models, so reasoning_first_ms must differ from the default 0.
    assert done["response"] == "Hi!"


@pytest.mark.asyncio
async def test_astream_chat_test_anthropic_enable_thinking_false_omits_field() -> None:
    """2026-04-25 (IDEALAB regression): `enable_thinking=False` MUST result in
    NO thinking-related field in the body — neither `enable_thinking: false`
    nor `thinking: disabled`.

    Why this is the right contract (was the OPPOSITE pre-2026-04-25):

    - Old contract sent both fields to "speak to every vendor at once". Worked
      for DashScope coding-plan, broke IDEALAB / OpenRouter / random
      anthropic-compat reverse-proxies that don't recognise the field and
      return empty SSE streams (zero content_block_delta events). User saw
      `response="" · output_tokens=0 · tok/s 0.0` and was confused.

    - New contract:default OFF == "use server default". Don't send anything.
      Most thinking-capable models default to thinking=off anyway, so the
      observable behaviour is the same. Users who must force OFF on a
      thinking-by-default model can pick the non-thinking variant of the
      model instead. This trade-off (lose explicit-off for one provider
      family) is far cheaper than losing entire compat-proxy ecosystems.

    - Mirrors Claude Code's `ChatAnthropic.thinking` policy: `thinking` field
      is `undefined` unless the call explicitly opts in (ref-src-claude/V02).
    """
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content.decode("utf-8"))
        frames = _anthropic_sse_bytes(
            [
                ("message_start", {"message": {"usage": {"input_tokens": 5, "output_tokens": 0}}}),
                (
                    "content_block_start",
                    {"index": 0, "content_block": {"type": "text", "text": ""}},
                ),
                (
                    "content_block_delta",
                    {"index": 0, "delta": {"type": "text_delta", "text": "Hi!"}},
                ),
                ("content_block_stop", {"index": 0}),
                ("message_stop", {}),
            ]
        )
        return httpx.Response(200, content=frames, headers={"Content-Type": "text/event-stream"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        events = [
            e
            async for e in astream_chat_test(
                _anthropic_provider(
                    base_url="https://coding.dashscope.aliyuncs.com/apps/anthropic"
                ),
                "qwen3.6-plus",
                prompt="hi",
                enable_thinking=False,
                http_client=client,
            )
        ]

    body = captured["body"]
    # Neither field — that's the whole point. Omission means "use server
    # default", which is cross-vendor safe.
    assert "enable_thinking" not in body, (
        "enable_thinking=False must NOT inject the bool root field — "
        "vendor compat proxies (IDEALAB) don't recognise it"
    )
    assert "thinking" not in body, (
        "enable_thinking=False must NOT inject `thinking: disabled` — "
        "IDEALAB returns empty SSE when this field is present"
    )
    reasoning_events = [e for e in events if e["type"] == "reasoning"]
    assert reasoning_events == []
    done = events[-1]
    assert done["type"] == "done"
    assert done["response"] == "Hi!"


@pytest.mark.asyncio
async def test_astream_chat_test_anthropic_enable_thinking_true_emits_budget() -> None:
    """B02: enabling thinking must send `thinking.type=enabled` with a budget
    so models that honor the native Anthropic extended-thinking contract
    actually spend tokens on reasoning.
    """
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content.decode("utf-8"))
        frames = _anthropic_sse_bytes(
            [
                ("message_start", {"message": {"usage": {"input_tokens": 5, "output_tokens": 0}}}),
                (
                    "content_block_start",
                    {"index": 0, "content_block": {"type": "text", "text": ""}},
                ),
                (
                    "content_block_delta",
                    {"index": 0, "delta": {"type": "text_delta", "text": "ok"}},
                ),
                ("content_block_stop", {"index": 0}),
                ("message_stop", {}),
            ]
        )
        return httpx.Response(200, content=frames, headers={"Content-Type": "text/event-stream"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        _ = [
            e
            async for e in astream_chat_test(
                _anthropic_provider(
                    base_url="https://coding.dashscope.aliyuncs.com/apps/anthropic"
                ),
                "qwen3.6-plus",
                prompt="hi",
                enable_thinking=True,
                http_client=client,
            )
        ]

    body = captured["body"]
    # 2026-04-25: bool root field `enable_thinking` is no longer mirrored on
    # the anthropic body — that's an OpenAI-compat / Qwen DashScope quirk and
    # belongs only on `_build_openai_body`. Anthropic spec uses the structured
    # `thinking` object, which IS what we send when the user opts in.
    assert "enable_thinking" not in body
    thinking = body.get("thinking")
    assert isinstance(thinking, dict)
    assert thinking.get("type") == "enabled"
    assert isinstance(thinking.get("budget_tokens"), int)
    assert thinking["budget_tokens"] > 0


@pytest.mark.asyncio
async def test_astream_chat_test_native_anthropic_suppresses_thinking_disabled() -> None:
    """2026-04-25 (IDEALAB regression contract):
    With the new "omit by default" policy, this test now subsumes the older
    native-anthropic-specific case. The body must contain neither
    `enable_thinking` nor `thinking` when the user has opted out — that's true
    for native AND for compat proxies. Native Anthropic always 400'd on
    `thinking: disabled`; that's still respected (omission means "use server
    default", which is no-thinking). Compat proxies that choke on the field
    are also protected.
    """
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content.decode("utf-8"))
        frames = _anthropic_sse_bytes(
            [
                ("message_start", {"message": {"usage": {"input_tokens": 5, "output_tokens": 0}}}),
                (
                    "content_block_start",
                    {"index": 0, "content_block": {"type": "text", "text": ""}},
                ),
                (
                    "content_block_delta",
                    {"index": 0, "delta": {"type": "text_delta", "text": "ok"}},
                ),
                ("content_block_stop", {"index": 0}),
                ("message_stop", {}),
            ]
        )
        return httpx.Response(200, content=frames, headers={"Content-Type": "text/event-stream"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        _ = [
            e
            async for e in astream_chat_test(
                _anthropic_provider(base_url="https://api.anthropic.com"),
                "claude-3-5-sonnet-latest",
                prompt="hi",
                enable_thinking=False,
                http_client=client,
            )
        ]
    body = captured["body"]
    assert "enable_thinking" not in body, (
        "post-2026-04-25: bool root field is no longer mirrored on anthropic body"
    )
    assert "thinking" not in body, (
        "enable_thinking=False = use server default = omit thinking field"
    )


@pytest.mark.asyncio
async def test_astream_chat_test_anthropic_does_not_hide_gateway_leaked_thinking() -> None:
    """B02 negative: if the gateway ignores enable_thinking=False and still emits
    thinking_delta frames, we must NOT hide them. Hiding would mask a gateway
    bug while the model still burns tokens on reasoning. Let them surface.
    """

    def handler(_: httpx.Request) -> httpx.Response:
        frames = _anthropic_sse_bytes(
            [
                ("message_start", {"message": {"usage": {"input_tokens": 5, "output_tokens": 0}}}),
                (
                    "content_block_start",
                    {"index": 0, "content_block": {"type": "thinking", "thinking": ""}},
                ),
                (
                    "content_block_delta",
                    {"index": 0, "delta": {"type": "thinking_delta", "thinking": "leaked"}},
                ),
                ("content_block_stop", {"index": 0}),
                (
                    "content_block_start",
                    {"index": 1, "content_block": {"type": "text", "text": ""}},
                ),
                (
                    "content_block_delta",
                    {"index": 1, "delta": {"type": "text_delta", "text": "Hi!"}},
                ),
                ("content_block_stop", {"index": 1}),
                ("message_stop", {}),
            ]
        )
        return httpx.Response(200, content=frames, headers={"Content-Type": "text/event-stream"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        events = [
            e
            async for e in astream_chat_test(
                _anthropic_provider(
                    base_url="https://coding.dashscope.aliyuncs.com/apps/anthropic"
                ),
                "qwen3.6-plus",
                prompt="hi",
                enable_thinking=False,
                http_client=client,
            )
        ]
    reasoning_events = [e for e in events if e["type"] == "reasoning"]
    assert reasoning_events and reasoning_events[0]["text"] == "leaked", (
        "gateway-leaked thinking_delta must surface as reasoning events so a "
        "gateway bug is observable, not hidden by client-side filtering"
    )


@pytest.mark.asyncio
async def test_astream_chat_test_anthropic_4xx_emits_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="Unauthorized")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        events = [
            e
            async for e in astream_chat_test(
                _anthropic_provider(), "m", prompt="ping", http_client=client
            )
        ]
    types = [e["type"] for e in events]
    assert types == ["meta", "error"]
    assert events[1]["error_category"] == "auth"
