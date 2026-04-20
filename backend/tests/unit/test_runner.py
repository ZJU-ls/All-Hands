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
from allhands.execution.events import DoneEvent, TokenEvent
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
