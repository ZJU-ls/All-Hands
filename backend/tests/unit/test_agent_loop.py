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

from allhands.core import Employee
from allhands.execution.agent_loop import AgentLoop
from allhands.execution.gate import AutoApproveGate
from allhands.execution.internal_events import (
    AssistantMessageCommitted,
    AssistantMessagePartial,
    LoopExited,
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
