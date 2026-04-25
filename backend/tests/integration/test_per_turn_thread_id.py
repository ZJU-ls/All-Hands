# ruff: noqa: E402
"""Regression: LangGraph checkpointer state must be scoped per-turn.

Root cause this guards: before the fix, chat_service passed
``thread_id=conversation_id`` on every turn. LangGraph's AsyncSqliteSaver
persists the full graph state under that thread_id, including any
AIMessage(tool_calls=[...]) that wasn't followed by a ToolMessage (e.g.
when a tool_use crashed mid-execution). On the next turn, the state
loads, validation runs, and LangChain raises INVALID_CHAT_HISTORY —
even though our event log + build_llm_context produced a clean
message list.

Claude Code invariant: each query() gets a fresh in-memory messages
array, no cross-query state leak. Our equivalent: fresh LangGraph
thread_id per turn. This test pins that invariant.
"""

from __future__ import annotations

import inspect

import pytest

pytestmark = pytest.mark.skip(reason="ADR 0018: legacy checkpointer/interrupt model · superseded")

from allhands.services.chat_service import ChatService


def test_send_message_uses_turn_id_as_thread_id() -> None:
    """The send_message source must pass thread_id=active_turn.turn_id
    (not conversation_id) when the event repo is wired. Static source
    inspection is enough — the runtime behavior is exercised in the
    end-to-end smoke conversation."""
    source = inspect.getsource(ChatService.send_message)
    # The fix introduces an explicit `thread_id = active_turn.turn_id`
    # assignment before runner.stream. Fallback to conversation_id is
    # allowed for the legacy (event_repo=None) path.
    assert "active_turn.turn_id" in source, (
        "send_message must scope thread_id to the active turn — "
        "sharing thread_id across turns re-introduces the stale "
        "AIMessage(tool_calls) bug"
    )


def test_resume_message_looks_up_turn_id_from_interrupt_event() -> None:
    """Resume must target the thread_id of the turn that actually raised
    the interrupt. Looking it up from the latest INTERRUPT_RAISED event
    is the only way to hit the right checkpoint slot now that thread_id
    is per-turn."""
    source = inspect.getsource(ChatService.resume_message)
    assert "INTERRUPT_RAISED" in source, (
        "resume_message must scan for the latest INTERRUPT_RAISED event to recover the turn_id"
    )
    assert "resume_thread_id" in source or "turn_id" in source, (
        "resume_message must derive thread_id from interrupt event"
    )
