"""ADR 0017 · P3.D — chain repair tests."""

from __future__ import annotations

from datetime import UTC, datetime

from allhands.core import ConversationEvent, EventKind
from allhands.services.chain_repair import (
    fill_orphan_tool_results,
    repair_parent_chain,
)


def _evt(
    id_: str,
    seq: int,
    kind: EventKind = EventKind.USER,
    parent_id: str | None = None,
) -> ConversationEvent:
    return ConversationEvent(
        id=id_,
        conversation_id="c",
        parent_id=parent_id,
        sequence=seq,
        kind=kind,
        content_json={"content": id_},
        created_at=datetime.now(UTC),
    )


def test_repair_with_no_snipped_is_identity() -> None:
    events = [_evt("e1", 1), _evt("e2", 2, parent_id="e1"), _evt("e3", 3, parent_id="e2")]
    assert repair_parent_chain(events) == events


def test_repair_skips_snipped_and_reassigns_parent() -> None:
    # e1 → e2 (snipped) → e3 → e4. After repair, e3 should point at e1.
    events = [
        _evt("e1", 1),
        _evt("e2", 2, parent_id="e1"),
        _evt("e3", 3, parent_id="e2"),
        _evt("e4", 4, parent_id="e3"),
    ]
    repaired = repair_parent_chain(events, snipped_ids={"e2"})
    ids = [e.id for e in repaired]
    assert ids == ["e1", "e3", "e4"]
    # e3.parent_id was e2 (snipped) → should now be e1
    repaired_e3 = next(e for e in repaired if e.id == "e3")
    assert repaired_e3.parent_id == "e1"
    # e4.parent_id was e3 (not snipped) → unchanged
    assert next(e for e in repaired if e.id == "e4").parent_id == "e3"


def test_repair_through_multiple_snipped() -> None:
    events = [
        _evt("e1", 1),
        _evt("e2", 2, parent_id="e1"),
        _evt("e3", 3, parent_id="e2"),
        _evt("e4", 4, parent_id="e3"),
    ]
    repaired = repair_parent_chain(events, snipped_ids={"e2", "e3"})
    assert [e.id for e in repaired] == ["e1", "e4"]
    assert next(e for e in repaired if e.id == "e4").parent_id == "e1"


def test_fill_orphan_tool_results_noop_when_none() -> None:
    msgs = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ]
    assert fill_orphan_tool_results(msgs) == msgs


def test_fill_orphan_tool_results_inserts_placeholder() -> None:
    msgs = [
        {"role": "user", "content": "calc 2+2"},
        {
            "role": "assistant",
            "content": [
                {"type": "tool_use", "id": "tu_a", "name": "calc", "input": {}},
                {"type": "tool_use", "id": "tu_b", "name": "calc", "input": {}},
            ],
        },
        # Only tu_a has a matching tool result — tu_b is orphan.
        {"role": "tool", "tool_call_id": "tu_a", "content": "4"},
        {"role": "user", "content": "keep going"},
    ]
    repaired = fill_orphan_tool_results(msgs)
    # Should have the original 4 + 1 synthetic = 5 messages
    assert len(repaired) == 5
    # The synthetic tool for tu_b should sit right after the assistant
    # that emitted the tool_use (index 1), so insert at index 2.
    synthetic = repaired[2]
    assert synthetic["role"] == "tool"
    assert synthetic["tool_call_id"] == "tu_b"
    assert "missing" in synthetic["content"].lower()


def test_fill_orphan_preserves_original_order() -> None:
    """Synthetic results are inserted, not appended — order matters
    for Anthropic's strict alternation."""
    msgs = [
        {"role": "user", "content": "q"},
        {
            "role": "assistant",
            "content": [{"type": "tool_use", "id": "tu_x", "name": "n", "input": {}}],
        },
        {"role": "user", "content": "second q"},
    ]
    repaired = fill_orphan_tool_results(msgs)
    assert [m["role"] for m in repaired] == ["user", "assistant", "tool", "user"]
