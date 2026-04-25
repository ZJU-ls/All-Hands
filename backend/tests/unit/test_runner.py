"""Tests for AgentRunner — drives the real LangGraph graph with a fake chat
model so the chunk shape can't silently drift.

Historically this file mocked `create_react_agent` with a fake that yielded
`{"messages": [...]}`. The real graph yields tuples in `stream_mode="messages"`
and node-scoped dicts in `stream_mode="updates"` — never the mock's shape.
The mock kept the test green while chat was silently dropping every token
because the code unwrapped the wrong key. Never again: these tests go end
to end through the real graph.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from allhands.core import Employee
from allhands.execution.events import (
    DoneEvent,
    RenderEvent,
    TokenEvent,
    ToolCallEndEvent,
    ToolCallStartEvent,
)
from allhands.execution.gate import AutoApproveGate
from allhands.execution.registry import ToolRegistry
from allhands.execution.runner import AgentRunner


def _make_employee() -> Employee:
    return Employee(
        id="e1",
        name="TestEmployee",
        description="test",
        system_prompt="You are helpful.",
        model_ref="openai/gpt-4o-mini",
        tool_ids=[],
        created_by="user",
        created_at=datetime.now(UTC),
    )


@pytest.mark.asyncio
async def test_runner_streams_tokens_from_real_graph() -> None:
    """A real `create_react_agent` run must surface assistant tokens.

    Regression for the "试用 没有任何反应" bug: the previous implementation
    called `chunk.get("messages", [])` on the default `astream()` output,
    which returns `{"agent": {"messages": [...]}}`. That lookup always
    returned `[]`, so no tokens ever reached the SSE layer — the UI saw the
    user's message echoed and absolutely nothing after.
    """
    model = GenericFakeChatModel(
        messages=iter([AIMessage(content="hello world")]),
    )
    with patch("allhands.execution.runner._build_model", return_value=model):
        runner = AgentRunner(
            employee=_make_employee(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
        )
        events = [
            e
            async for e in runner.stream(
                messages=[{"role": "user", "content": "hi"}],
                thread_id="t1",
            )
        ]

    tokens = [e for e in events if isinstance(e, TokenEvent)]
    dones = [e for e in events if isinstance(e, DoneEvent)]
    assert tokens, (
        "runner yielded zero TokenEvents — chat will appear to hang. "
        f"Saw kinds: {[e.kind for e in events]}"
    )
    assert "".join(str(t.delta) for t in tokens) == "hello world"
    assert dones and dones[-1].reason == "done"


@pytest.mark.asyncio
async def test_runner_yields_error_event_on_model_failure() -> None:
    """If the graph raises mid-stream (e.g. upstream 401), the runner must
    surface an ErrorEvent so the SSE layer can encode it as `RUN_ERROR`.
    Without this, transient auth failures turn into a silent hang."""

    class _ExplodingAgent:
        async def astream(self, *args: object, **kwargs: object):  # type: ignore[no-untyped-def]
            raise RuntimeError("upstream 401: invalid api key")
            yield  # pragma: no cover — makes this an async generator

    model = GenericFakeChatModel(messages=iter([AIMessage(content="unused")]))
    with (
        patch("allhands.execution.runner._build_model", return_value=model),
        patch(
            "langgraph.prebuilt.create_react_agent",
            return_value=_ExplodingAgent(),
        ),
    ):
        runner = AgentRunner(
            employee=_make_employee(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
        )
        events = [
            e
            async for e in runner.stream(
                messages=[{"role": "user", "content": "hi"}],
                thread_id="t2",
            )
        ]

    kinds = [e.kind for e in events]
    assert "error" in kinds, f"expected an ErrorEvent but got: {kinds}"
    # DoneEvent must still close the stream so the SSE layer emits RUN_FINISHED.
    assert kinds[-1] == "done"


@pytest.mark.asyncio
async def test_runner_emits_render_event_when_tool_returns_envelope() -> None:
    """A Render Tool's `{component, props, interactions}` result must surface
    as a RenderEvent so the frontend can dispatch it into the component
    registry. The bug this regression-guards: runner filtered the tools node
    out of the LangGraph stream, so render envelopes were silently dropped
    and the Lead Agent's visualization calls produced only text in the UI.

    We mock the graph at the stream boundary rather than drive a real
    `create_react_agent`, because GenericFakeChatModel has no `bind_tools`
    implementation — the agent wrapper crashes on construction. Since
    ADR 0014 Phase 3 the runner subscribes to ``stream_mode=["messages",
    "updates"]``, so each chunk is ``(mode, payload)`` — we yield the
    ``"messages"`` variant here where ``payload`` is the original
    ``(AIMessageChunk | ToolMessage, meta)`` pair.
    """
    from langchain_core.messages import AIMessageChunk, ToolMessage

    class _FakeAgent:
        async def astream(self, *args: object, **kwargs: object):  # type: ignore[no-untyped-def]
            # Agent node streams tokens + final tool_calls.
            yield (
                "messages",
                (
                    AIMessageChunk(content="Looking up rows…"),
                    {"langgraph_node": "agent"},
                ),
            )
            yield (
                "messages",
                (
                    AIMessageChunk(
                        content="",
                        tool_calls=[
                            {
                                "id": "call_render_1",
                                "name": "render_table",
                                "args": {
                                    "columns": [{"key": "n", "label": "N"}],
                                    "rows": [{"n": "alpha"}, {"n": "beta"}],
                                },
                            }
                        ],
                    ),
                    {"langgraph_node": "agent"},
                ),
            )
            # Tools node returns the render envelope as JSON-encoded content
            # (matches what LangGraph's ToolNode does for dict results).
            import json as _json

            envelope = {
                "component": "Viz.Table",
                "props": {
                    "columns": [{"key": "n", "label": "N"}],
                    "rows": [{"n": "alpha"}, {"n": "beta"}],
                },
                "interactions": [],
            }
            yield (
                "messages",
                (
                    ToolMessage(
                        content=_json.dumps(envelope),
                        tool_call_id="call_render_1",
                        name="render_table",
                    ),
                    {"langgraph_node": "tools"},
                ),
            )
            # Final assistant turn.
            yield (
                "messages",
                (
                    AIMessageChunk(content="Here is the table."),
                    {"langgraph_node": "agent"},
                ),
            )

    model = GenericFakeChatModel(messages=iter([AIMessage(content="unused")]))
    with (
        patch("allhands.execution.runner._build_model", return_value=model),
        patch(
            "langgraph.prebuilt.create_react_agent",
            return_value=_FakeAgent(),
        ),
    ):
        runner = AgentRunner(
            employee=_make_employee(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
        )
        events = [
            e
            async for e in runner.stream(
                messages=[{"role": "user", "content": "show me a table"}],
                thread_id="t-render-1",
            )
        ]

    kinds = [e.kind for e in events]
    assert "tool_call_start" in kinds, f"missing tool_call_start; saw: {kinds}"
    assert "tool_call_end" in kinds, f"missing tool_call_end; saw: {kinds}"
    assert "render" in kinds, f"missing render event; saw: {kinds}"

    starts = [e for e in events if isinstance(e, ToolCallStartEvent)]
    ends = [e for e in events if isinstance(e, ToolCallEndEvent)]
    renders = [e for e in events if isinstance(e, RenderEvent)]

    assert len(starts) == 1
    assert starts[0].tool_call.tool_id == "render_table"
    assert starts[0].tool_call.id == "call_render_1"

    assert len(ends) == 1
    assert ends[0].tool_call.id == "call_render_1"
    assert ends[0].tool_call.status.value == "succeeded"
    # Result round-trips as the original dict (not a JSON blob) so
    # persistence + the render envelope detector both see structured data.
    result = ends[0].tool_call.result
    assert isinstance(result, dict)
    assert result.get("component") == "Viz.Table"

    assert len(renders) == 1
    assert renders[0].payload.component == "Viz.Table"
    assert renders[0].payload.props["rows"] == [{"n": "alpha"}, {"n": "beta"}]

    # Final-turn tokens still flow through as TokenEvents.
    tokens_text = "".join(str(e.delta) for e in events if isinstance(e, TokenEvent))
    assert "Here is the table." in tokens_text


@pytest.mark.asyncio
async def test_runner_emits_failed_end_when_tool_call_never_executes() -> None:
    """Regression: gpt-4o-mini sometimes streams a tool_call in the agent
    node but the tools node never fires (e.g. dropped/empty args). Without
    a synthetic ToolCallEnd the frontend leaves the card pinned at
    'pending' forever and the persisted message has no terminal state for
    that tool_call. The runner must close every started tool_call before
    DoneEvent — failed if no ToolMessage ever arrived.
    """
    from langchain_core.messages import AIMessageChunk

    class _DropAgent:
        async def astream(self, *args: object, **kwargs: object):  # type: ignore[no-untyped-def]
            yield (
                "messages",
                (
                    AIMessageChunk(content="creating it now"),
                    {"langgraph_node": "agent"},
                ),
            )
            yield (
                "messages",
                (
                    AIMessageChunk(
                        content="",
                        tool_calls=[
                            {"id": "call_dropped_1", "name": "artifact_create", "args": {}}
                        ],
                    ),
                    {"langgraph_node": "agent"},
                ),
            )
            # No tools-node ToolMessage. Stream just ends.

    model = GenericFakeChatModel(messages=iter([AIMessage(content="unused")]))
    with (
        patch("allhands.execution.runner._build_model", return_value=model),
        patch("langgraph.prebuilt.create_react_agent", return_value=_DropAgent()),
    ):
        runner = AgentRunner(
            employee=_make_employee(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
        )
        events = [
            e
            async for e in runner.stream(
                messages=[{"role": "user", "content": "make an artifact"}],
                thread_id="t-drop-1",
            )
        ]

    starts = [e for e in events if isinstance(e, ToolCallStartEvent)]
    ends = [e for e in events if isinstance(e, ToolCallEndEvent)]
    assert len(starts) == 1
    assert len(ends) == 1, f"expected synthetic end, got events: {[e.kind for e in events]}"
    assert ends[0].tool_call.id == "call_dropped_1"
    assert ends[0].tool_call.status.value == "failed"
    assert ends[0].tool_call.error == "tool_call_dropped"
    # DoneEvent still closes the stream after the synthetic end.
    assert events[-1].kind == "done"


# --- E18 regression · _bind_thinking + _build_model provider-kind dispatch ---


def test_bind_thinking_anthropic_kind_is_a_no_op_at_bind_layer() -> None:
    """E18: ChatAnthropic.thinking is a ctor field; .bind(thinking=...) does
    not reach _get_request_payload. So _bind_thinking must not add anything
    for anthropic kind — the field is already baked in at build_llm time.
    """
    from allhands.execution.runner import _bind_thinking

    kwargs: dict = {}
    _bind_thinking(kwargs, thinking=False, provider_kind="anthropic")
    assert kwargs == {}, "anthropic kind must NOT bind thinking via .bind()"

    kwargs = {}
    _bind_thinking(kwargs, thinking=True, provider_kind="anthropic")
    assert kwargs == {}


def test_bind_thinking_openai_kind_uses_extra_body() -> None:
    """OpenAI-compat adapters (DashScope compat mode, Qwen3 native, DeepSeek)
    honour `extra_body={"enable_thinking": bool}` as a call-time pass-through.
    """
    from allhands.execution.runner import _bind_thinking

    kwargs: dict = {}
    _bind_thinking(kwargs, thinking=False, provider_kind="openai")
    assert kwargs == {"extra_body": {"enable_thinking": False}}

    kwargs = {}
    _bind_thinking(kwargs, thinking=True, provider_kind="aliyun")
    assert kwargs == {"extra_body": {"enable_thinking": True}}


def test_build_model_plumbs_thinking_to_anthropic_ctor() -> None:
    """End-to-end: given an anthropic provider + overrides.thinking=False, the
    built model must carry `thinking={"type": "disabled"}` at the LC adapter
    level. If this regresses the grey button surfaces reasoning again.
    """
    from allhands.core.provider import LLMProvider
    from allhands.core.run_overrides import RunOverrides
    from allhands.execution.runner import _build_model

    provider = LLMProvider(
        id="p1",
        name="DashscopeAnthropic",
        kind="anthropic",
        base_url="https://coding.dashscope.aliyuncs.com/apps/anthropic",
        api_key="sk-fake",
        default_model="qwen3.6-plus",
        is_default=True,
    )
    model = _build_model(
        "qwen3.6-plus",
        provider=provider,
        overrides=RunOverrides(thinking=False),
    )
    # _apply_overrides wraps the underlying model in a RunnableBinding when
    # there are non-thinking knobs — but for a `thinking=False` only override
    # on anthropic kind, there are zero bind_kwargs, so the return is the
    # bare ChatAnthropic (the `thinking` field lives on the ctor instance).
    underlying = getattr(model, "bound", model)
    assert getattr(underlying, "thinking", None) == {"type": "disabled"}
