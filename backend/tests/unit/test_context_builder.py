"""ADR 0017 · build_llm_context projection contract tests.

Covers:
- USER / ASSISTANT / TOOL / SYSTEM / SUMMARY / TURN_ABORTED projection
- Metadata events (TURN_STARTED/COMPLETED, SKILL_ACTIVATED, TOOL_CALL_*
  except EXECUTED/FAILED, INTERRUPT_*) stay out of the LLM message list
- Alternation contract · TURN_ABORTED synthesizes assistant messages
  so consecutive user messages never leak to the provider
- System override · skill descriptors · resolved_fragments all land in
  system_prompt in deterministic order
- Pure function · calling twice yields identical output
- max_history_events truncation preserves SUMMARY + recent tail
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from allhands.core import (
    ConversationEvent,
    Employee,
    EventKind,
    SkillRuntime,
    TurnAbortReason,
)
from allhands.services.context_builder import build_llm_context


class _InMemoryEventRepo:
    """Minimal ConversationEventRepo implementation for pure projection tests."""

    def __init__(self, events: list[ConversationEvent]) -> None:
        self._events = list(events)

    async def list_by_conversation(
        self,
        conversation_id: str,
        *,
        include_compacted: bool = True,
        subagent_id: str | None = None,
    ) -> list[ConversationEvent]:
        out = [e for e in self._events if e.conversation_id == conversation_id]
        if not include_compacted:
            out = [e for e in out if not e.is_compacted]
        if subagent_id is None:
            out = [e for e in out if e.subagent_id is None]
        elif subagent_id != "*":
            out = [e for e in out if e.subagent_id == subagent_id]
        return sorted(out, key=lambda e: e.sequence)


def _evt(
    seq: int,
    kind: EventKind,
    *,
    conv: str = "conv",
    content: dict | None = None,
    turn_id: str | None = None,
    is_compacted: bool = False,
) -> ConversationEvent:
    return ConversationEvent(
        id=str(uuid.uuid4()),
        conversation_id=conv,
        parent_id=None,
        sequence=seq,
        kind=kind,
        content_json=content or {},
        subagent_id=None,
        turn_id=turn_id,
        idempotency_key=None,
        is_compacted=is_compacted,
        created_at=datetime.now(UTC),
    )


def _emp(prompt: str = "You are a helpful assistant.") -> Employee:
    return Employee(
        id="emp-ctxbuilder",
        name="ctxb",
        description="",
        system_prompt=prompt,
        model_ref="default",
        tool_ids=[],
        skill_ids=[],
        max_iterations=5,
        is_lead_agent=False,
        created_by="system",
        created_at=datetime.now(UTC),
        metadata={},
    )


def _runtime() -> SkillRuntime:
    return SkillRuntime()


@pytest.mark.asyncio
async def test_empty_conversation_returns_empty_messages() -> None:
    repo = _InMemoryEventRepo([])
    sys, msgs = await build_llm_context("conv", _emp(), _runtime(), repo)
    assert sys == "You are a helpful assistant."
    assert msgs == []


@pytest.mark.asyncio
async def test_user_then_assistant_projects_cleanly() -> None:
    events = [
        _evt(1, EventKind.USER, content={"content": "hello"}),
        _evt(2, EventKind.ASSISTANT, content={"content": "hi!"}),
    ]
    repo = _InMemoryEventRepo(events)
    _, msgs = await build_llm_context("conv", _emp(), _runtime(), repo)
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"
    assert msgs[0]["content"] == "hello"
    assert msgs[1]["role"] == "assistant"
    assert msgs[1]["content"] == "hi!"


@pytest.mark.asyncio
async def test_assistant_with_content_blocks_preserves_structure() -> None:
    blocks = [
        {"type": "text", "text": "Let me check."},
        {"type": "tool_use", "id": "tu_1", "name": "calc", "input": {"x": 2}},
    ]
    events = [
        _evt(1, EventKind.USER, content={"content": "what is 2+2?"}),
        _evt(2, EventKind.ASSISTANT, content={"content_blocks": blocks}),
        _evt(
            3,
            EventKind.TOOL_CALL_EXECUTED,
            content={"tool_use_id": "tu_1", "content": "4"},
        ),
    ]
    repo = _InMemoryEventRepo(events)
    _, msgs = await build_llm_context("conv", _emp(), _runtime(), repo)
    assert msgs[1]["role"] == "assistant"
    assert msgs[1]["content"] == blocks
    assert msgs[2]["role"] == "tool"
    assert msgs[2]["tool_call_id"] == "tu_1"
    assert msgs[2]["content"] == "4"


@pytest.mark.asyncio
async def test_turn_aborted_projects_synthetic_assistant() -> None:
    """Plan §1 core contract: user_superseded must materialize as a short
    synthetic assistant message between the two user messages so providers
    that enforce user/assistant alternation (Anthropic) don't reject."""
    events = [
        _evt(1, EventKind.USER, content={"content": "first question"}),
        _evt(2, EventKind.TURN_STARTED, turn_id="t1"),
        _evt(
            3,
            EventKind.TURN_ABORTED,
            turn_id="t1",
            content={"turn_id": "t1", "reason": TurnAbortReason.USER_SUPERSEDED.value},
        ),
        _evt(4, EventKind.USER, content={"content": "second question"}),
        _evt(5, EventKind.ASSISTANT, content={"content": "addressing second"}),
    ]
    repo = _InMemoryEventRepo(events)
    _, msgs = await build_llm_context("conv", _emp(), _runtime(), repo)
    assert len(msgs) == 4
    roles = [m["role"] for m in msgs]
    assert roles == ["user", "assistant", "user", "assistant"]
    # First assistant is the synthetic one
    assert (
        "interrupted" in msgs[1]["content"].lower() or "new message" in msgs[1]["content"].lower()
    )
    # Second assistant is the real reply
    assert msgs[3]["content"] == "addressing second"


@pytest.mark.asyncio
async def test_summary_event_injected_as_user_reminder() -> None:
    events = [
        _evt(
            1,
            EventKind.SUMMARY,
            content={
                "summary_text": "User asked about Python; assistant showed list comprehension.",
                "covers_sequence_range": [1, 20],
            },
        ),
        _evt(21, EventKind.USER, content={"content": "now about tuples"}),
    ]
    repo = _InMemoryEventRepo(events)
    _, msgs = await build_llm_context("conv", _emp(), _runtime(), repo)
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"
    assert "previous_conversation_summary" in msgs[0]["content"]
    assert "list comprehension" in msgs[0]["content"]
    assert msgs[1]["content"] == "now about tuples"


@pytest.mark.asyncio
async def test_metadata_events_are_skipped() -> None:
    """TURN_STARTED / TURN_COMPLETED / SKILL_ACTIVATED / INTERRUPT_* /
    TOOL_CALL_REQUESTED/APPROVED/DENIED are audit-only — they must NOT
    reach the LLM message list."""
    events = [
        _evt(1, EventKind.USER, content={"content": "hello"}),
        _evt(2, EventKind.TURN_STARTED, turn_id="t1"),
        _evt(3, EventKind.TOOL_CALL_REQUESTED, content={"tool_use_id": "tu_1"}),
        _evt(4, EventKind.TOOL_CALL_APPROVED, content={"tool_use_id": "tu_1"}),
        _evt(5, EventKind.SKILL_ACTIVATED, content={"skill_id": "sk_research"}),
        _evt(6, EventKind.INTERRUPT_RAISED, content={}),
        _evt(7, EventKind.INTERRUPT_RESUMED, content={}),
        _evt(8, EventKind.ASSISTANT, content={"content": "done"}),
        _evt(9, EventKind.TURN_COMPLETED, turn_id="t1"),
    ]
    repo = _InMemoryEventRepo(events)
    _, msgs = await build_llm_context("conv", _emp(), _runtime(), repo)
    assert [m["role"] for m in msgs] == ["user", "assistant"]


@pytest.mark.asyncio
async def test_system_override_prepends_to_system_prompt() -> None:
    repo = _InMemoryEventRepo([])
    sys, _ = await build_llm_context(
        "conv", _emp("base prompt"), _runtime(), repo, system_override="runtime snapshot"
    )
    # Override comes BEFORE base prompt (Lead snapshot pattern · E20)
    assert sys.index("runtime snapshot") < sys.index("base prompt")


@pytest.mark.asyncio
async def test_resolved_fragments_appear_in_system_prompt() -> None:
    runtime = SkillRuntime()
    runtime.resolved_fragments.append("You are also a skilled researcher.")
    repo = _InMemoryEventRepo([])
    sys, _ = await build_llm_context("conv", _emp(), runtime, repo)
    assert "helpful assistant" in sys
    assert "skilled researcher" in sys


@pytest.mark.asyncio
async def test_pure_function_no_side_effects() -> None:
    events = [
        _evt(1, EventKind.USER, content={"content": "q"}),
        _evt(2, EventKind.ASSISTANT, content={"content": "a"}),
    ]
    repo = _InMemoryEventRepo(events)
    emp = _emp()
    runtime = _runtime()
    out1 = await build_llm_context("conv", emp, runtime, repo)
    out2 = await build_llm_context("conv", emp, runtime, repo)
    assert out1 == out2
    # Calling the function must not have mutated the runtime or repo
    assert runtime.resolved_fragments == []


@pytest.mark.asyncio
async def test_max_history_events_truncation_keeps_summary_and_tail() -> None:
    """max_history_events=10 on a 50-event conversation: summary events
    survive, plus the latest 10 non-summary tail."""
    events: list[ConversationEvent] = []
    events.append(
        _evt(
            1,
            EventKind.SUMMARY,
            content={"summary_text": "early summary", "covers_sequence_range": [1, 3]},
        )
    )
    # 50 alternating user/assistant pairs
    for i in range(2, 52):
        kind = EventKind.USER if i % 2 == 0 else EventKind.ASSISTANT
        events.append(_evt(i, kind, content={"content": f"msg-{i}"}))

    repo = _InMemoryEventRepo(events)
    _, msgs = await build_llm_context("conv", _emp(), _runtime(), repo, max_history_events=10)
    # Summary + 10 tail events = 11 messages total
    assert len(msgs) == 11
    # First message must be the summary projection
    assert "previous_conversation_summary" in msgs[0]["content"]
    # Last event is sequence=51, so tail should be 42..51 (10 events)
    assert msgs[-1]["content"] == "msg-51"
    assert msgs[1]["content"] == "msg-42"


@pytest.mark.asyncio
async def test_consecutive_user_events_are_merged() -> None:
    """Edge case: if two USER events arrive back-to-back (e.g. rapid
    client resend before TURN_ABORTED can be written), context_builder
    merges them with a (Follow-up) annotation so the alternation contract
    is never violated at projection time."""
    events = [
        _evt(1, EventKind.USER, content={"content": "first"}),
        _evt(2, EventKind.USER, content={"content": "second"}),
        _evt(3, EventKind.ASSISTANT, content={"content": "got it"}),
    ]
    repo = _InMemoryEventRepo(events)
    _, msgs = await build_llm_context("conv", _emp(), _runtime(), repo)
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert "first" in msgs[0]["content"]
    assert "(Follow-up) second" in msgs[0]["content"]


@pytest.mark.asyncio
async def test_tool_call_failed_projects_error_content() -> None:
    events = [
        _evt(
            1,
            EventKind.ASSISTANT,
            content={
                "content_blocks": [{"type": "tool_use", "id": "tu_1", "name": "calc", "input": {}}]
            },
        ),
        _evt(
            2,
            EventKind.TOOL_CALL_FAILED,
            content={"tool_use_id": "tu_1", "error": "division by zero"},
        ),
    ]
    repo = _InMemoryEventRepo(events)
    _, msgs = await build_llm_context("conv", _emp(), _runtime(), repo)
    assert msgs[-1]["role"] == "tool"
    assert msgs[-1]["content"] == "division by zero"


@pytest.mark.asyncio
async def test_system_event_appends_to_system_prompt() -> None:
    events = [
        _evt(
            1,
            EventKind.SYSTEM,
            content={"content": "Employee activated debug mode for this conversation."},
        ),
        _evt(2, EventKind.USER, content={"content": "ok"}),
    ]
    repo = _InMemoryEventRepo(events)
    sys, msgs = await build_llm_context("conv", _emp(), _runtime(), repo)
    assert "debug mode" in sys
    assert [m["role"] for m in msgs] == ["user"]


@pytest.mark.asyncio
async def test_compacted_events_excluded_by_default() -> None:
    """Once auto-compact marks events as is_compacted=True, the default
    projection skips them (the SUMMARY event stands in)."""
    events = [
        _evt(1, EventKind.USER, content={"content": "old u1"}, is_compacted=True),
        _evt(2, EventKind.ASSISTANT, content={"content": "old a1"}, is_compacted=True),
        _evt(
            3,
            EventKind.SUMMARY,
            content={"summary_text": "compacted 1-2"},
        ),
        _evt(4, EventKind.USER, content={"content": "new u1"}),
    ]
    repo = _InMemoryEventRepo(events)
    _, msgs = await build_llm_context("conv", _emp(), _runtime(), repo, include_compacted=False)
    assert [m["role"] for m in msgs] == ["user", "user"]  # summary as user + new user
    assert "compacted 1-2" in msgs[0]["content"]
    assert msgs[1]["content"] == "new u1"
