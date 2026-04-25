"""ADR 0018 · AgentLoop tests.

The loop is the heart of the new architecture. Drives:
  - one or more LLM turns (while no tool_calls in committed message)
  - tool execution via tool_pipeline
  - emits internal events (terminal + preview) — AG-UI translation
    happens at api/ boundary, not here

Tests grow incrementally per plan task:
  Task 6 (this commit): text-only turn
  Task 7: while-true with tool execution
  Task 8: deferred (confirmation) flow
  Task 9: concurrency partition observable
  Task 10: phantom rejection regression
  Task 11: skill/dispatch/subagent wiring
  Task 12: max_iterations + abort exit reasons
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from unittest.mock import patch

import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, AIMessageChunk

from allhands.core import Employee, Tool, ToolKind, ToolScope
from allhands.core.conversation import ToolUseBlock
from allhands.execution.agent_loop import AgentLoop
from allhands.execution.gate import AutoApproveGate
from allhands.execution.internal_events import (
    AssistantMessageCommitted,
    AssistantMessagePartial,
    LoopExited,
    ToolMessageCommitted,
)
from allhands.execution.registry import ToolRegistry


def _employee(**overrides: Any) -> Employee:
    base: dict[str, Any] = {
        "id": "e1",
        "name": "t",
        "description": "t",
        "system_prompt": "You are helpful.",
        "model_ref": "openai/gpt-4o-mini",
        "tool_ids": [],
        "created_by": "u",
        "created_at": datetime.now(UTC),
    }
    base.update(overrides)
    return Employee(**base)


# --- Task 6: text-only turn -------------------------------------------------


@pytest.mark.asyncio
async def test_loop_streams_text_only_turn() -> None:
    """One LLM turn produces only text → loop emits partials, commits a
    text-only assistant message, exits with reason='completed'."""
    model = GenericFakeChatModel(messages=iter([AIMessage(content="hello world")]))
    with patch("allhands.execution.agent_loop._build_model", return_value=model):
        loop = AgentLoop(
            employee=_employee(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
        )
        events = [
            ev
            async for ev in loop.stream(
                messages=[{"role": "user", "content": "hi"}],
            )
        ]

    partials = [ev for ev in events if isinstance(ev, AssistantMessagePartial)]
    committed = [ev for ev in events if isinstance(ev, AssistantMessageCommitted)]
    exits = [ev for ev in events if isinstance(ev, LoopExited)]

    assert "".join(p.text_delta for p in partials) == "hello world"
    assert len(committed) == 1
    assert committed[0].message.role == "assistant"
    assert committed[0].message.content == "hello world"
    assert len(committed[0].message.content_blocks) == 1
    assert committed[0].message.content_blocks[0].type == "text"
    assert len(exits) == 1
    assert exits[-1].reason == "completed"


@pytest.mark.asyncio
async def test_loop_emits_committed_after_partials_in_order() -> None:
    """The terminal commit MUST come AFTER all partials for that
    message_id. Frontends and persistence taps rely on this ordering
    to project the message correctly."""
    model = GenericFakeChatModel(messages=iter([AIMessage(content="abc")]))
    with patch("allhands.execution.agent_loop._build_model", return_value=model):
        loop = AgentLoop(
            employee=_employee(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
        )
        events = [ev async for ev in loop.stream(messages=[{"role": "user", "content": "hi"}])]

    # Find positions
    commit_idx = next(i for i, ev in enumerate(events) if isinstance(ev, AssistantMessageCommitted))
    last_partial_idx = max(
        i for i, ev in enumerate(events) if isinstance(ev, AssistantMessagePartial)
    )
    assert last_partial_idx < commit_idx


@pytest.mark.asyncio
async def test_loop_splits_reasoning_from_text() -> None:
    """Anthropic Extended Thinking + Qwen3 + DeepSeek-R1 emit content
    blocks with type='thinking' or 'reasoning'. The loop routes those
    to AssistantMessagePartial.reasoning_delta, never to text_delta."""

    class _ThinkingModel:
        async def astream(self, *_a: object, **_kw: object) -> Any:
            yield AIMessageChunk(
                content=[
                    {"type": "thinking", "thinking": "let me think"},
                    {"type": "text", "text": "the answer is 42"},
                ]
            )

        def bind_tools(self, *_a: object, **_kw: object) -> Any:
            return self

    with patch("allhands.execution.agent_loop._build_model", return_value=_ThinkingModel()):
        loop = AgentLoop(
            employee=_employee(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
        )
        events = [ev async for ev in loop.stream(messages=[{"role": "user", "content": "hi"}])]

    partials = [ev for ev in events if isinstance(ev, AssistantMessagePartial)]
    text = "".join(p.text_delta for p in partials)
    reasoning = "".join(p.reasoning_delta for p in partials)
    assert text == "the answer is 42"
    assert reasoning == "let me think"


@pytest.mark.asyncio
async def test_loop_yields_loop_exited_aborted_on_internal_exception() -> None:
    """An exception inside the loop body becomes a LoopExited(aborted)
    sentinel rather than an unhandled traceback. Stream callers can
    rely on a terminal LoopExited even on the error path."""

    class _BoomModel:
        async def astream(self, *_a: object, **_kw: object) -> Any:
            raise RuntimeError("upstream blew up")
            yield  # pragma: no cover  — make it an async generator

        def bind_tools(self, *_a: object, **_kw: object) -> Any:
            return self

    with patch("allhands.execution.agent_loop._build_model", return_value=_BoomModel()):
        loop = AgentLoop(
            employee=_employee(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
        )
        events = [ev async for ev in loop.stream(messages=[{"role": "user", "content": "hi"}])]
    exits = [ev for ev in events if isinstance(ev, LoopExited)]
    assert len(exits) == 1
    assert exits[0].reason == "aborted"
    assert exits[0].detail and "blew up" in exits[0].detail


@pytest.mark.asyncio
async def test_loop_preserves_message_id_consistency_across_partials_and_commit() -> None:
    """All partials for one assistant turn carry the SAME message_id; the
    committed message has that same id. Persistence keys on this."""
    model = GenericFakeChatModel(messages=iter([AIMessage(content="test")]))
    with patch("allhands.execution.agent_loop._build_model", return_value=model):
        loop = AgentLoop(
            employee=_employee(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
        )
        events = [ev async for ev in loop.stream(messages=[{"role": "user", "content": "hi"}])]

    partials = [ev for ev in events if isinstance(ev, AssistantMessagePartial)]
    committed = [ev for ev in events if isinstance(ev, AssistantMessageCommitted)]
    assert partials  # at least one
    partial_ids = {p.message_id for p in partials}
    assert len(partial_ids) == 1
    assert committed[0].message.id in partial_ids


# --- Task 7: while-true with tool execution --------------------------------


def _tool(
    name: str,
    *,
    scope: ToolScope = ToolScope.READ,
    requires_confirmation: bool = False,
) -> Tool:
    return Tool(
        id=f"t.{name}",
        kind=ToolKind.BACKEND,
        name=name,
        description=f"{name} tool",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        scope=scope,
        requires_confirmation=requires_confirmation,
    )


class _ScriptedModel:
    """Fake chat model that returns a scripted sequence of AIMessageChunks
    across successive astream() calls. bind_tools() is a no-op (returns
    self) — the script controls what tool_calls appear."""

    def __init__(self, scripts: list[list[AIMessageChunk]]) -> None:
        self._scripts = list(scripts)
        self._calls = 0

    def bind_tools(self, *_a: object, **_kw: object) -> Any:
        return self

    async def astream(self, *_a: object, **_kw: object) -> Any:
        if self._calls >= len(self._scripts):
            raise AssertionError(
                f"_ScriptedModel called {self._calls + 1} times but only {len(self._scripts)} scripts"
            )
        chunks = self._scripts[self._calls]
        self._calls += 1
        for chunk in chunks:
            yield chunk


@pytest.mark.asyncio
async def test_loop_executes_tool_and_continues_to_next_turn() -> None:
    """Iter 1: model emits a tool_call → loop runs the tool → emits
    ToolMessageCommitted → appends both to history → iter 2: model
    emits text → loop exits completed."""
    add = _tool("add")

    async def _add(**kw: Any) -> dict[str, int]:
        return {"sum": kw["a"] + kw["b"]}

    reg = ToolRegistry()
    reg.register(add, _add)

    scripts = [
        [
            AIMessageChunk(
                content="",
                tool_calls=[{"id": "tu1", "name": "add", "args": {"a": 2, "b": 3}}],
            )
        ],
        [AIMessageChunk(content="sum is 5")],
    ]
    emp = _employee(tool_ids=["t.add"])
    with patch("allhands.execution.agent_loop._build_model", return_value=_ScriptedModel(scripts)):
        loop = AgentLoop(employee=emp, tool_registry=reg, gate=AutoApproveGate())
        events = [
            ev async for ev in loop.stream(messages=[{"role": "user", "content": "add 2 and 3"}])
        ]

    committed = [ev for ev in events if isinstance(ev, AssistantMessageCommitted)]
    tool_committed = [ev for ev in events if isinstance(ev, ToolMessageCommitted)]
    exits = [ev for ev in events if isinstance(ev, LoopExited)]

    assert len(committed) == 2
    iter1_blocks = committed[0].message.content_blocks
    tool_uses = [b for b in iter1_blocks if isinstance(b, ToolUseBlock)]
    assert len(tool_uses) == 1
    assert tool_uses[0].name == "add"
    assert tool_uses[0].input == {"a": 2, "b": 3}

    assert len(tool_committed) == 1
    assert tool_committed[0].message.tool_call_id == "tu1"
    assert tool_committed[0].message.content == {"sum": 5}

    assert committed[1].message.content == "sum is 5"
    assert exits[-1].reason == "completed"


@pytest.mark.asyncio
async def test_loop_event_order_assistant_before_tool_before_next_assistant() -> None:
    """The transcript order is critical for replay correctness:
    AssistantMessageCommitted (with tool_use) → ToolMessageCommitted →
    AssistantMessageCommitted (next turn). No interleaving."""
    add = _tool("add")

    async def _add(**kw: Any) -> dict[str, int]:
        return {"x": 1}

    reg = ToolRegistry()
    reg.register(add, _add)
    scripts = [
        [AIMessageChunk(content="", tool_calls=[{"id": "tu1", "name": "add", "args": {}}])],
        [AIMessageChunk(content="ok")],
    ]
    emp = _employee(tool_ids=["t.add"])
    with patch("allhands.execution.agent_loop._build_model", return_value=_ScriptedModel(scripts)):
        loop = AgentLoop(employee=emp, tool_registry=reg, gate=AutoApproveGate())
        events = [ev async for ev in loop.stream(messages=[{"role": "user", "content": "go"}])]

    # Filter to only the three terminal events of interest
    terminal_kinds = []
    for ev in events:
        if isinstance(ev, AssistantMessageCommitted):
            terminal_kinds.append("assistant")
        elif isinstance(ev, ToolMessageCommitted):
            terminal_kinds.append("tool")
        elif isinstance(ev, LoopExited):
            terminal_kinds.append("exit")

    assert terminal_kinds == ["assistant", "tool", "assistant", "exit"]


@pytest.mark.asyncio
async def test_loop_records_tool_executor_error_and_continues() -> None:
    """An exception in the tool executor records as a synthetic
    {"error": ...} envelope on the ToolMessage. The loop continues —
    the model gets the error in the next turn and can adjust."""
    bad = _tool("bad")

    async def _explode(**_: Any) -> dict[str, Any]:
        raise ValueError("nope")

    reg = ToolRegistry()
    reg.register(bad, _explode)
    scripts = [
        [AIMessageChunk(content="", tool_calls=[{"id": "tu1", "name": "bad", "args": {}}])],
        [AIMessageChunk(content="oh well")],
    ]
    emp = _employee(tool_ids=["t.bad"])
    with patch("allhands.execution.agent_loop._build_model", return_value=_ScriptedModel(scripts)):
        loop = AgentLoop(employee=emp, tool_registry=reg, gate=AutoApproveGate())
        events = [ev async for ev in loop.stream(messages=[{"role": "user", "content": "go"}])]

    tool_committed = [ev for ev in events if isinstance(ev, ToolMessageCommitted)]
    exits = [ev for ev in events if isinstance(ev, LoopExited)]
    assert len(tool_committed) == 1
    assert isinstance(tool_committed[0].message.content, dict)
    assert "nope" in str(tool_committed[0].message.content.get("error", ""))
    assert exits[-1].reason == "completed"


# --- Task 10 (folded in here for B1 closure): phantom regression -----------


@pytest.mark.asyncio
async def test_loop_phantom_tool_call_in_chunks_does_not_become_tool_use_block() -> None:
    """Mid-stream tool_call_chunks the model later abandons MUST NOT
    produce a ToolUseBlock in the committed AssistantMessage. The
    protocol-level defense against phantom tool_calls.

    This regresses the gpt-4o-mini bug where a chunk with name+id but
    abandoned args was treated as a real tool call by the legacy
    LangGraph runner."""

    class _PhantomModel:
        def bind_tools(self, *_a: object, **_kw: object) -> Any:
            return self

        async def astream(self, *_a: object, **_kw: object) -> Any:
            # Phantom: model starts a tool_call_chunk but never commits it
            yield AIMessageChunk(
                content="",
                tool_call_chunks=[
                    {
                        "index": 0,
                        "id": "phantom",
                        "name": "x",
                        "args": "",
                        "type": "tool_call_chunk",
                    }
                ],
            )
            # Then commits to plain text — final accumulated.tool_calls
            # should have no validly-shaped entries (empty args)
            yield AIMessageChunk(content="never mind, just text.")

    emp = _employee(tool_ids=[])
    with patch("allhands.execution.agent_loop._build_model", return_value=_PhantomModel()):
        loop = AgentLoop(employee=emp, tool_registry=ToolRegistry(), gate=AutoApproveGate())
        events = [ev async for ev in loop.stream(messages=[{"role": "user", "content": "hi"}])]

    committed = [ev for ev in events if isinstance(ev, AssistantMessageCommitted)]
    tool_committed = [ev for ev in events if isinstance(ev, ToolMessageCommitted)]
    exits = [ev for ev in events if isinstance(ev, LoopExited)]

    # Phantom MUST NOT have produced a ToolUseBlock
    assert len(committed) == 1
    blocks = committed[0].message.content_blocks
    tool_uses = [b for b in blocks if isinstance(b, ToolUseBlock)]
    assert tool_uses == [], f"phantom tool_call leaked into content_blocks: {tool_uses}"
    # No tool messages committed (no tool_use → nothing to execute)
    assert tool_committed == []
    # Loop exits cleanly
    assert exits[-1].reason == "completed"


@pytest.mark.asyncio
async def test_loop_replays_tool_history_into_lc_messages() -> None:
    """Multi-turn correctness: when the user passes a history that
    includes a prior assistant message with tool_calls + a tool result,
    the loop reconstructs LangChain AIMessage + ToolMessage in the
    correct order so the next LLM call sees a valid Anthropic-style
    transcript (no orphaned tool_use)."""
    add = _tool("add")

    async def _add(**_: Any) -> dict[str, int]:
        return {"sum": 0}

    reg = ToolRegistry()
    reg.register(add, _add)

    captured: list[Any] = []

    class _Inspector:
        def bind_tools(self, *_a: object, **_kw: object) -> Any:
            return self

        async def astream(self, msgs: list[Any], **_kw: object) -> Any:
            captured.append(list(msgs))
            yield AIMessageChunk(content="ok")

    emp = _employee(tool_ids=["t.add"])
    with patch("allhands.execution.agent_loop._build_model", return_value=_Inspector()):
        loop = AgentLoop(employee=emp, tool_registry=reg, gate=AutoApproveGate())
        history = [
            {"role": "user", "content": "first"},
            {
                "role": "assistant",
                "content": "calling tool",
                "tool_calls": [{"id": "tu_old", "name": "add", "args": {"a": 1}}],
            },
            {"role": "tool", "content": '{"sum": 1}', "tool_call_id": "tu_old"},
            {"role": "user", "content": "second"},
        ]
        _ = [ev async for ev in loop.stream(messages=history)]

    # Inspector saw the lc_messages list passed to astream
    assert captured, "model never called"
    msgs = captured[0]
    # Check the role pattern in order
    from langchain_core.messages import AIMessage as LCAI
    from langchain_core.messages import SystemMessage as LCSys

    types = [type(m).__name__ for m in msgs]
    assert "SystemMessage" in types
    assert types.count("HumanMessage") == 2
    assert types.count("AIMessage") == 1
    assert types.count("ToolMessage") == 1
    # Order: System, Human(first), AI(with tool_calls), Tool(result), Human(second)
    non_sys = [type(m).__name__ for m in msgs if not isinstance(m, LCSys)]
    assert non_sys == ["HumanMessage", "AIMessage", "ToolMessage", "HumanMessage"]
    # AIMessage carried the tool_calls
    ai_msg = next(m for m in msgs if isinstance(m, LCAI))
    assert ai_msg.tool_calls and ai_msg.tool_calls[0]["id"] == "tu_old"
