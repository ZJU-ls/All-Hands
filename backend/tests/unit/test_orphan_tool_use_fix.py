"""Regression: ASSISTANT event stored with ``tool_calls`` (internal format)
must project as Anthropic content_blocks so (a) the LLM sees the tool_use
it originally emitted, and (b) ``fill_orphan_tool_results`` can detect
missing tool_result pairs and synthesize placeholders.

Root cause the fix addresses: without this projection, a prior turn that
crashed mid-tool-execution (ASSISTANT event written with tool_calls
but no matching TOOL_CALL_EXECUTED event) leaves the LLM with an
AIMessage(tool_calls=[...]) after LangChain auto-extracts them, and
no ToolMessage matches — LangChain raises INVALID_CHAT_HISTORY.
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
)
from allhands.services.context_builder import build_llm_context


class _InMemoryEventRepo:
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
        return sorted(out, key=lambda e: e.sequence)


def _emp() -> Employee:
    return Employee(
        id="emp",
        name="t",
        description="",
        system_prompt="x",
        model_ref="default",
        tool_ids=[],
        skill_ids=[],
        max_iterations=3,
        is_lead_agent=False,
        created_by="system",
        created_at=datetime.now(UTC),
        metadata={},
    )


def _evt(seq: int, kind: EventKind, content: dict) -> ConversationEvent:
    return ConversationEvent(
        id=str(uuid.uuid4()),
        conversation_id="conv",
        parent_id=None,
        sequence=seq,
        kind=kind,
        content_json=content,
        created_at=datetime.now(UTC),
    )


@pytest.mark.asyncio
async def test_assistant_tool_calls_projected_as_tool_use_blocks() -> None:
    """ASSISTANT event with tool_calls dicts (our internal format) should
    project as {type:tool_use} blocks inside content — so LLM sees the
    original tool call request."""
    events = [
        _evt(1, EventKind.USER, {"content": "write a report"}),
        _evt(
            2,
            EventKind.ASSISTANT,
            {
                "content": "Sure, writing the report now.",
                "tool_calls": [
                    {
                        "id": "toolu_abc123",
                        "tool_id": "write_file",
                        "args": {"path": "report.md", "content": "hello"},
                        "status": "succeeded",
                    }
                ],
            },
        ),
        _evt(
            3,
            EventKind.TOOL_CALL_EXECUTED,
            {"tool_use_id": "toolu_abc123", "content": "file written"},
        ),
    ]
    repo = _InMemoryEventRepo(events)
    _, msgs = await build_llm_context("conv", _emp(), SkillRuntime(), repo)

    # Assistant should project as a list of content_blocks
    ast = next(m for m in msgs if m["role"] == "assistant")
    assert isinstance(ast["content"], list), (
        f"expected content_blocks list; got {type(ast['content'])}"
    )
    kinds = [b.get("type") for b in ast["content"]]
    assert "text" in kinds
    assert "tool_use" in kinds
    tool_block = next(b for b in ast["content"] if b.get("type") == "tool_use")
    assert tool_block["id"] == "toolu_abc123"
    assert tool_block["name"] == "write_file"
    assert tool_block["input"] == {"path": "report.md", "content": "hello"}

    # Tool message projected for the result
    tool_msg = next(m for m in msgs if m["role"] == "tool")
    assert tool_msg["tool_call_id"] == "toolu_abc123"


@pytest.mark.asyncio
async def test_orphan_tool_use_gets_synthetic_result() -> None:
    """The reported bug: ASSISTANT event with tool_calls but NO matching
    TOOL_CALL_EXECUTED event (e.g. write_file call that crashed before
    the executor finished). build_llm_context must insert a synthetic
    tool_result so Anthropic doesn't 400 with 'orphan tool_use'."""
    events = [
        _evt(1, EventKind.USER, {"content": "write something"}),
        _evt(
            2,
            EventKind.ASSISTANT,
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "toolu_2499a0b4664e4c3683b1d6cd",
                        "tool_id": "write_file",
                        "args": {"path": "x.md", "content": "..."},
                        "status": "pending",
                    }
                ],
            },
        ),
        # No TOOL_CALL_EXECUTED — crash / network drop / provider aborted.
        _evt(3, EventKind.USER, {"content": "hello again"}),
    ]
    repo = _InMemoryEventRepo(events)
    _, msgs = await build_llm_context("conv", _emp(), SkillRuntime(), repo)

    # Must contain a tool message pairing the orphan tool_use.
    tool_msgs = [m for m in msgs if m["role"] == "tool"]
    assert len(tool_msgs) == 1
    assert tool_msgs[0]["tool_call_id"] == "toolu_2499a0b4664e4c3683b1d6cd"
    assert "missing" in tool_msgs[0]["content"].lower()


@pytest.mark.asyncio
async def test_multiple_parallel_tool_calls_orphan_each_pair_synthesized() -> None:
    """Two parallel tool calls, one has a result, the other is orphan.
    Only the orphan should get a synthetic tool_result."""
    events = [
        _evt(1, EventKind.USER, {"content": "do two things"}),
        _evt(
            2,
            EventKind.ASSISTANT,
            {
                "content": "",
                "tool_calls": [
                    {
                        "id": "toolu_a",
                        "tool_id": "calc",
                        "args": {"x": 2},
                        "status": "succeeded",
                    },
                    {
                        "id": "toolu_b",
                        "tool_id": "calc",
                        "args": {"x": 3},
                        "status": "pending",  # orphan
                    },
                ],
            },
        ),
        _evt(
            3,
            EventKind.TOOL_CALL_EXECUTED,
            {"tool_use_id": "toolu_a", "content": "4"},
        ),
    ]
    repo = _InMemoryEventRepo(events)
    _, msgs = await build_llm_context("conv", _emp(), SkillRuntime(), repo)
    tool_msgs = [m for m in msgs if m["role"] == "tool"]
    ids = {m["tool_call_id"] for m in tool_msgs}
    assert ids == {"toolu_a", "toolu_b"}
    # Synthetic placeholder for b
    b_msg = next(m for m in tool_msgs if m["tool_call_id"] == "toolu_b")
    assert "missing" in b_msg["content"].lower()
