"""ADR 0018 · content_block model on Message.

The new agent loop yields events that carry typed content_blocks
(TextBlock / ToolUseBlock / ReasoningBlock) rather than a flat
``content: str``. Persistence keeps ``content`` for back-compat —
populated from concatenated text blocks at commit time.

Boundary contract:
- ``content_blocks`` is the authoritative source inside execution/.
- ``content`` is a derived projection (concatenated text) for legacy
  callers (chat_service tap, services/list_messages, …).
- Either both populated and consistent, or only ``content`` populated
  (legacy path, content_blocks defaults to []).
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from allhands.core.conversation import (
    ContentBlock,
    Message,
    ReasoningBlock,
    TextBlock,
    ToolUseBlock,
)


def _now() -> datetime:
    return datetime.now(UTC)


# --- Block round-trip ---------------------------------------------------------


def test_text_block_round_trip() -> None:
    b = TextBlock(text="hello")
    dumped = b.model_dump()
    assert dumped == {"type": "text", "text": "hello"}
    assert TextBlock.model_validate(dumped) == b


def test_tool_use_block_round_trip() -> None:
    b = ToolUseBlock(id="tu1", name="add", input={"a": 1, "b": 2})
    dumped = b.model_dump()
    assert dumped == {"type": "tool_use", "id": "tu1", "name": "add", "input": {"a": 1, "b": 2}}
    rebuilt = ToolUseBlock.model_validate(dumped)
    assert rebuilt == b


def test_reasoning_block_round_trip() -> None:
    b = ReasoningBlock(text="thinking step")
    dumped = b.model_dump()
    assert dumped == {"type": "reasoning", "text": "thinking step"}
    assert ReasoningBlock.model_validate(dumped) == b


def test_content_block_discriminator_dispatches_to_correct_subtype() -> None:
    """ContentBlock is a discriminated union — passing a raw dict picks the
    right subtype based on the `type` field."""
    from pydantic import TypeAdapter

    ta = TypeAdapter(ContentBlock)
    a = ta.validate_python({"type": "text", "text": "hi"})
    b = ta.validate_python({"type": "tool_use", "id": "x", "name": "y", "input": {}})
    c = ta.validate_python({"type": "reasoning", "text": "z"})
    assert isinstance(a, TextBlock)
    assert isinstance(b, ToolUseBlock)
    assert isinstance(c, ReasoningBlock)


# --- Message integration ------------------------------------------------------


def test_message_legacy_content_only_back_compat() -> None:
    """Old call sites that build Message with content="..." and no
    content_blocks must keep working. content_blocks defaults to []."""
    m = Message(
        id="m1",
        conversation_id="c1",
        role="assistant",
        content="hello",
        created_at=_now(),
    )
    assert m.content == "hello"
    assert m.content_blocks == []


def test_message_with_content_blocks_back_fills_content() -> None:
    """When constructed with content_blocks but no content, the validator
    derives content as concatenated text blocks. Legacy consumers reading
    ``content`` keep working."""
    m = Message(
        id="m1",
        conversation_id="c1",
        role="assistant",
        content="",
        content_blocks=[
            TextBlock(text="thinking..."),
            ToolUseBlock(id="tu1", name="add", input={"a": 1}),
            TextBlock(text=" done"),
        ],
        created_at=_now(),
    )
    # ToolUseBlock is not text — only TextBlocks contribute to content
    assert m.content == "thinking... done"
    assert len(m.content_blocks) == 3


def test_message_explicit_content_overrides_derivation() -> None:
    """Caller can pin content to a specific string even with blocks. Useful
    for legacy migration where content was already computed."""
    m = Message(
        id="m1",
        conversation_id="c1",
        role="assistant",
        content="custom override",
        content_blocks=[TextBlock(text="will not be concatenated")],
        created_at=_now(),
    )
    assert m.content == "custom override"


def test_message_with_tool_use_blocks_only_has_empty_content() -> None:
    """An assistant message that's purely tool calls (no text) ends up
    with content="" — that's the on-wire shape Anthropic returns when
    the assistant emits only tool_use blocks."""
    m = Message(
        id="m1",
        conversation_id="c1",
        role="assistant",
        content="",
        content_blocks=[
            ToolUseBlock(id="tu1", name="add", input={"a": 1, "b": 2}),
            ToolUseBlock(id="tu2", name="mul", input={"a": 3, "b": 4}),
        ],
        created_at=_now(),
    )
    assert m.content == ""
    assert len(m.content_blocks) == 2
    assert all(b.type == "tool_use" for b in m.content_blocks)


def test_tool_use_block_extraction_helper() -> None:
    """Loop needs to scan an assistant message and pull its tool_use blocks
    in order. Provide a helper so callers don't isinstance-iterate."""
    m = Message(
        id="m1",
        conversation_id="c1",
        role="assistant",
        content="",
        content_blocks=[
            TextBlock(text="calling tools"),
            ToolUseBlock(id="tu1", name="add", input={"a": 1}),
            ReasoningBlock(text="step"),
            ToolUseBlock(id="tu2", name="mul", input={"a": 2}),
        ],
        created_at=_now(),
    )
    uses = [b for b in m.content_blocks if isinstance(b, ToolUseBlock)]
    assert len(uses) == 2
    assert [u.id for u in uses] == ["tu1", "tu2"]


def test_message_round_trip_with_blocks() -> None:
    """JSON round-trip preserves the discriminated union."""
    m = Message(
        id="m1",
        conversation_id="c1",
        role="assistant",
        content="",
        content_blocks=[
            TextBlock(text="hi"),
            ToolUseBlock(id="tu1", name="add", input={"a": 1}),
        ],
        created_at=_now(),
    )
    dumped = m.model_dump_json()
    rebuilt = Message.model_validate_json(dumped)
    assert rebuilt.content_blocks == m.content_blocks


def test_tool_use_block_input_must_be_dict() -> None:
    with pytest.raises(ValidationError):
        ToolUseBlock(id="tu1", name="add", input="not a dict")  # type: ignore[arg-type]
