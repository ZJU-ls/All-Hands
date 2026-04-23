"""ADR 0017 · SqlConversationEventRepo contract tests.

These lock the append-only invariants (sequence monotonic per conversation,
idempotency dedup, orphan-turn scan, subagent sidechain filter, compaction
soft-flag). The higher layers (``build_llm_context``, ``chat_service``) depend
on these.
"""

from __future__ import annotations

import contextlib
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from allhands.core import ConversationEvent, EventKind
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlConversationEventRepo


@pytest.fixture
async def repo() -> AsyncIterator[SqlConversationEventRepo]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    session = maker()
    try:
        yield SqlConversationEventRepo(session)
    finally:
        with contextlib.suppress(Exception):
            await session.rollback()
        await session.close()
        await engine.dispose()


def _make_event(
    *,
    conversation_id: str,
    kind: EventKind = EventKind.USER,
    sequence: int = 1,
    content: dict | None = None,
    turn_id: str | None = None,
    parent_id: str | None = None,
    idempotency_key: str | None = None,
    subagent_id: str | None = None,
) -> ConversationEvent:
    return ConversationEvent(
        id=str(uuid.uuid4()),
        conversation_id=conversation_id,
        parent_id=parent_id,
        sequence=sequence,
        kind=kind,
        content_json=content or {"content": "hi"},
        subagent_id=subagent_id,
        turn_id=turn_id,
        idempotency_key=idempotency_key,
        created_at=datetime.now(UTC),
    )


@pytest.mark.asyncio
async def test_next_sequence_monotonic_per_conversation(
    repo: SqlConversationEventRepo,
) -> None:
    conv_a = "conv-a"
    conv_b = "conv-b"
    assert await repo.next_sequence(conv_a) == 1
    await repo.append(_make_event(conversation_id=conv_a, sequence=1))
    assert await repo.next_sequence(conv_a) == 2
    # Second conversation keeps its own counter
    assert await repo.next_sequence(conv_b) == 1
    await repo.append(_make_event(conversation_id=conv_b, sequence=1))
    assert await repo.next_sequence(conv_b) == 2
    assert await repo.next_sequence(conv_a) == 2


@pytest.mark.asyncio
async def test_list_by_conversation_orders_by_sequence(
    repo: SqlConversationEventRepo,
) -> None:
    conv = "conv-seq"
    # Insert out of order to prove ORDER BY works.
    await repo.append(_make_event(conversation_id=conv, sequence=3, content={"i": 3}))
    await repo.append(_make_event(conversation_id=conv, sequence=1, content={"i": 1}))
    await repo.append(_make_event(conversation_id=conv, sequence=2, content={"i": 2}))
    events = await repo.list_by_conversation(conv)
    assert [e.sequence for e in events] == [1, 2, 3]
    assert [e.content_json["i"] for e in events] == [1, 2, 3]


@pytest.mark.asyncio
async def test_idempotency_key_dedup(repo: SqlConversationEventRepo) -> None:
    conv = "conv-idem"
    key = "client-retry-1"
    first = _make_event(conversation_id=conv, sequence=1, idempotency_key=key)
    await repo.append(first)
    found = await repo.get_by_idempotency_key(conv, key)
    assert found is not None
    assert found.id == first.id

    # Appending a second event with the same key on the same conversation
    # must violate the partial unique index (SqlAlchemy raises IntegrityError).
    dup = _make_event(conversation_id=conv, sequence=2, idempotency_key=key)
    with pytest.raises(Exception):
        await repo.append(dup)


@pytest.mark.asyncio
async def test_idempotency_key_scoped_per_conversation(
    repo: SqlConversationEventRepo,
) -> None:
    # Same key on different conversations is fine.
    key = "shared-key"
    await repo.append(_make_event(conversation_id="conv-1", sequence=1, idempotency_key=key))
    await repo.append(_make_event(conversation_id="conv-2", sequence=1, idempotency_key=key))
    assert (await repo.get_by_idempotency_key("conv-1", key)) is not None
    assert (await repo.get_by_idempotency_key("conv-2", key)) is not None


@pytest.mark.asyncio
async def test_find_orphan_turns(repo: SqlConversationEventRepo) -> None:
    conv = "conv-orphan"
    # Turn A: started but never closed (orphan)
    turn_a = "turn-a"
    await repo.append(
        _make_event(
            conversation_id=conv,
            sequence=1,
            kind=EventKind.TURN_STARTED,
            turn_id=turn_a,
        )
    )
    # Turn B: started and completed (not orphan)
    turn_b = "turn-b"
    await repo.append(
        _make_event(
            conversation_id=conv,
            sequence=2,
            kind=EventKind.TURN_STARTED,
            turn_id=turn_b,
        )
    )
    await repo.append(
        _make_event(
            conversation_id=conv,
            sequence=3,
            kind=EventKind.TURN_COMPLETED,
            turn_id=turn_b,
        )
    )
    # Turn C: started and aborted (not orphan — aborted counts as closed)
    turn_c = "turn-c"
    await repo.append(
        _make_event(
            conversation_id=conv,
            sequence=4,
            kind=EventKind.TURN_STARTED,
            turn_id=turn_c,
        )
    )
    await repo.append(
        _make_event(
            conversation_id=conv,
            sequence=5,
            kind=EventKind.TURN_ABORTED,
            turn_id=turn_c,
        )
    )

    orphans = await repo.find_orphan_turns(conv)
    assert orphans == [turn_a]


@pytest.mark.asyncio
async def test_subagent_sidechain_filter(repo: SqlConversationEventRepo) -> None:
    conv = "conv-sidechain"
    # Main conversation events (no subagent_id)
    await repo.append(_make_event(conversation_id=conv, sequence=1, content={"v": "main1"}))
    await repo.append(_make_event(conversation_id=conv, sequence=2, content={"v": "main2"}))
    # Subagent A events
    await repo.append(
        _make_event(
            conversation_id=conv,
            sequence=3,
            subagent_id="agent-a",
            content={"v": "a1"},
        )
    )
    await repo.append(
        _make_event(
            conversation_id=conv,
            sequence=4,
            subagent_id="agent-a",
            content={"v": "a2"},
        )
    )
    # Subagent B events
    await repo.append(
        _make_event(
            conversation_id=conv,
            sequence=5,
            subagent_id="agent-b",
            content={"v": "b1"},
        )
    )

    # Main-only (default)
    main = await repo.list_by_conversation(conv)
    assert [e.content_json["v"] for e in main] == ["main1", "main2"]

    # Specific subagent
    a = await repo.list_by_conversation(conv, subagent_id="agent-a")
    assert [e.content_json["v"] for e in a] == ["a1", "a2"]

    # All events (star sentinel)
    every = await repo.list_by_conversation(conv, subagent_id="*")
    assert [e.content_json["v"] for e in every] == ["main1", "main2", "a1", "a2", "b1"]


@pytest.mark.asyncio
async def test_mark_compacted_and_filter(repo: SqlConversationEventRepo) -> None:
    conv = "conv-compact"
    e1 = _make_event(conversation_id=conv, sequence=1)
    e2 = _make_event(conversation_id=conv, sequence=2)
    e3 = _make_event(conversation_id=conv, sequence=3)
    await repo.append(e1)
    await repo.append(e2)
    await repo.append(e3)

    # mark first two as compacted
    await repo.mark_compacted([e1.id, e2.id])

    with_all = await repo.list_by_conversation(conv, include_compacted=True)
    assert len(with_all) == 3
    assert [e.is_compacted for e in with_all] == [True, True, False]

    live_only = await repo.list_by_conversation(conv, include_compacted=False)
    assert len(live_only) == 1
    assert live_only[0].id == e3.id


@pytest.mark.asyncio
async def test_get_returns_none_for_missing(repo: SqlConversationEventRepo) -> None:
    assert (await repo.get("does-not-exist")) is None


@pytest.mark.asyncio
async def test_roundtrip_preserves_all_fields(repo: SqlConversationEventRepo) -> None:
    original = ConversationEvent(
        id=str(uuid.uuid4()),
        conversation_id="conv-rt",
        parent_id="parent-xyz",
        sequence=7,
        kind=EventKind.ASSISTANT,
        content_json={"content": "hello", "blocks": [{"type": "text", "text": "hi"}]},
        subagent_id="agent-x",
        turn_id="turn-xyz",
        idempotency_key=None,
        is_compacted=False,
        created_at=datetime.now(UTC),
    )
    await repo.append(original)

    loaded = await repo.get(original.id)
    assert loaded is not None
    assert loaded.id == original.id
    assert loaded.conversation_id == original.conversation_id
    assert loaded.parent_id == original.parent_id
    assert loaded.sequence == original.sequence
    assert loaded.kind == EventKind.ASSISTANT
    assert loaded.content_json == original.content_json
    assert loaded.subagent_id == original.subagent_id
    assert loaded.turn_id == original.turn_id
