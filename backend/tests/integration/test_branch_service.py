"""ADR 0017 · P3.B — branch / regenerate.

Contracts:
- branch_from_event creates a new Conversation and copies events up to
  and including the fork point.
- Both source and new conversation get CONVERSATION_FORKED markers.
- regenerate_last_turn forks from the last USER event.
- New conversation inherits employee_id + model_ref_override.
- Source conversation's events are unchanged except for the appended
  CONVERSATION_FORKED marker.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from allhands.core import (
    Conversation,
    ConversationEvent,
    Employee,
    EventKind,
)
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import (
    SqlConversationEventRepo,
    SqlConversationRepo,
    SqlEmployeeRepo,
)
from allhands.services.branch_service import (
    branch_from_event,
    regenerate_last_turn,
)


@pytest.fixture
async def setup() -> AsyncIterator[
    tuple[SqlConversationRepo, SqlConversationEventRepo, str, list[str]]
]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    emp = Employee(
        id="emp-p3b",
        name="p3b",
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
    conv = Conversation(
        id=f"conv-{uuid.uuid4().hex[:8]}",
        employee_id=emp.id,
        title="source",
        model_ref_override="override-model",
        created_at=datetime.now(UTC),
        metadata={},
    )
    async with maker() as session:
        await SqlEmployeeRepo(session).upsert(emp)
        await SqlConversationRepo(session).create(conv)

    session = maker()
    repo = SqlConversationRepo(session)
    event_repo = SqlConversationEventRepo(session)
    # Seed 2 turns
    event_ids: list[str] = []
    for i in range(2):
        u = ConversationEvent(
            id=str(uuid.uuid4()),
            conversation_id=conv.id,
            parent_id=None,
            sequence=await event_repo.next_sequence(conv.id),
            kind=EventKind.USER,
            content_json={"content": f"u{i}"},
            created_at=datetime.now(UTC),
        )
        await event_repo.append(u)
        event_ids.append(u.id)
        a = ConversationEvent(
            id=str(uuid.uuid4()),
            conversation_id=conv.id,
            parent_id=None,
            sequence=await event_repo.next_sequence(conv.id),
            kind=EventKind.ASSISTANT,
            content_json={"content": f"a{i}"},
            created_at=datetime.now(UTC),
        )
        await event_repo.append(a)
        event_ids.append(a.id)

    try:
        yield repo, event_repo, conv.id, event_ids
    finally:
        await session.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_branch_copies_events_through_fork_point(
    setup: tuple[SqlConversationRepo, SqlConversationEventRepo, str, list[str]],
) -> None:
    repo, event_repo, source_id, event_ids = setup
    # Fork at the 2nd event (a0) — the new branch gets [u0, a0] seed.
    fork_eid = event_ids[1]
    new_conv = await branch_from_event(
        source_conversation_id=source_id,
        from_event_id=fork_eid,
        new_title="branch test",
        conversation_repo=repo,
        event_repo=event_repo,
    )
    # New conversation inherits employee + model override
    assert new_conv.employee_id == "emp-p3b"
    assert new_conv.model_ref_override == "override-model"
    assert new_conv.title == "branch test"
    assert new_conv.metadata["branched_from"] == source_id

    # New branch events: u0, a0, CONVERSATION_FORKED (genesis marker)
    new_events = await event_repo.list_by_conversation(new_conv.id)
    kinds = [e.kind for e in new_events]
    assert EventKind.USER in kinds
    assert EventKind.ASSISTANT in kinds
    assert new_events[-1].kind == EventKind.CONVERSATION_FORKED
    # Exactly 2 copied + 1 fork marker
    assert len(new_events) == 3
    assert new_events[0].content_json["content"] == "u0"
    assert new_events[1].content_json["content"] == "a0"


@pytest.mark.asyncio
async def test_branch_source_gets_fork_marker(
    setup: tuple[SqlConversationRepo, SqlConversationEventRepo, str, list[str]],
) -> None:
    repo, event_repo, source_id, event_ids = setup
    original_count = len(await event_repo.list_by_conversation(source_id))
    new_conv = await branch_from_event(
        source_conversation_id=source_id,
        from_event_id=event_ids[1],
        new_title=None,
        conversation_repo=repo,
        event_repo=event_repo,
    )
    after = await event_repo.list_by_conversation(source_id)
    assert len(after) == original_count + 1  # fork marker appended
    marker = after[-1]
    assert marker.kind == EventKind.CONVERSATION_FORKED
    assert marker.content_json["new_conversation_id"] == new_conv.id


@pytest.mark.asyncio
async def test_regenerate_last_turn_forks_at_last_user(
    setup: tuple[SqlConversationRepo, SqlConversationEventRepo, str, list[str]],
) -> None:
    repo, event_repo, source_id, _event_ids = setup
    # Last user is event_ids[2] (seed pattern: u0, a0, u1, a1)
    new_conv = await regenerate_last_turn(
        conversation_id=source_id,
        conversation_repo=repo,
        event_repo=event_repo,
    )
    new_events = await event_repo.list_by_conversation(new_conv.id)
    # Up to u1 (inclusive) = 3 copied events + 1 fork marker
    assert new_events[-1].kind == EventKind.CONVERSATION_FORKED
    content_seq = [
        e.content_json.get("content")
        for e in new_events
        if e.kind in (EventKind.USER, EventKind.ASSISTANT)
    ]
    assert content_seq == ["u0", "a0", "u1"]


@pytest.mark.asyncio
async def test_branch_from_invalid_event_raises(
    setup: tuple[SqlConversationRepo, SqlConversationEventRepo, str, list[str]],
) -> None:
    repo, event_repo, source_id, _event_ids = setup
    with pytest.raises(ValueError, match="does not belong"):
        await branch_from_event(
            source_conversation_id=source_id,
            from_event_id="not-a-real-event",
            new_title=None,
            conversation_repo=repo,
            event_repo=event_repo,
        )


@pytest.mark.asyncio
async def test_regenerate_no_user_raises(
    setup: tuple[SqlConversationRepo, SqlConversationEventRepo, str, list[str]],
) -> None:
    repo, event_repo, _source_id, _event_ids = setup
    # Blank second conversation with no events
    empty_conv = Conversation(
        id=f"conv-{uuid.uuid4().hex[:8]}",
        employee_id="emp-p3b",
        title=None,
        created_at=datetime.now(UTC),
        metadata={},
    )
    await repo.create(empty_conv)
    with pytest.raises(ValueError, match="no user message"):
        await regenerate_last_turn(
            conversation_id=empty_conv.id,
            conversation_repo=repo,
            event_repo=event_repo,
        )
