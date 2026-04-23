"""ADR 0017 · P2.A — turn lifecycle + supersede + crash recovery.

Regressions guarded:
- TURN_STARTED + TURN_COMPLETED bracket a normal turn
- A new user message mid-turn writes TURN_ABORTED(user_superseded)
  for the prior turn before the new TURN_STARTED
- Stream error writes TURN_ABORTED(stream_error) (via chat_service's
  error branch — covered in existing regression)
- scan_and_close_orphan_turns closes leftover TURN_STARTED with
  reason=crash_recovery
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
    TurnAbortReason,
)
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import (
    SqlConversationEventRepo,
    SqlConversationRepo,
    SqlEmployeeRepo,
)
from allhands.services.turn_lock import (
    TurnLockManager,
    scan_and_close_orphan_turns,
)


@pytest.fixture
async def setup() -> AsyncIterator[tuple[SqlConversationRepo, SqlConversationEventRepo, str]]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    emp = Employee(
        id="emp-p2a",
        name="p2a",
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
        title=None,
        created_at=datetime.now(UTC),
        metadata={},
    )
    async with maker() as session, session.begin():
        await SqlEmployeeRepo(session).upsert(emp)
        await SqlConversationRepo(session).create(conv)

    session = maker()
    try:
        yield (
            SqlConversationRepo(session),
            SqlConversationEventRepo(session),
            conv.id,
        )
    finally:
        await session.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_start_then_complete_turn_writes_both_boundaries(
    setup: tuple[SqlConversationRepo, SqlConversationEventRepo, str],
) -> None:
    _, event_repo, conv_id = setup
    lock = TurnLockManager()
    turn = lock.start_turn(conv_id, run_id="r1")
    # start_turn is in-memory; chat_service writes TURN_STARTED. Simulate:
    await event_repo.append(
        ConversationEvent(
            id=str(uuid.uuid4()),
            conversation_id=conv_id,
            parent_id=None,
            sequence=await event_repo.next_sequence(conv_id),
            kind=EventKind.TURN_STARTED,
            content_json={"turn_id": turn.turn_id},
            turn_id=turn.turn_id,
            created_at=datetime.now(UTC),
        )
    )
    await lock.complete_turn(event_repo, conv_id, turn)

    events = await event_repo.list_by_conversation(conv_id)
    kinds = [e.kind for e in events]
    assert EventKind.TURN_STARTED in kinds
    assert EventKind.TURN_COMPLETED in kinds
    assert lock.active_turn(conv_id) is None


@pytest.mark.asyncio
async def test_supersede_writes_turn_aborted_for_prior_turn(
    setup: tuple[SqlConversationRepo, SqlConversationEventRepo, str],
) -> None:
    _, event_repo, conv_id = setup
    lock = TurnLockManager()
    prior = lock.start_turn(conv_id, run_id="r1")
    prior.partial_content.append("I was ")
    prior.partial_content.append("thinking...")

    superseded = await lock.supersede_if_active(event_repo, conv_id)
    assert superseded is not None
    assert superseded.turn_id == prior.turn_id

    events = await event_repo.list_by_conversation(conv_id)
    aborted = [e for e in events if e.kind == EventKind.TURN_ABORTED]
    assert len(aborted) == 1
    assert aborted[0].content_json["reason"] == TurnAbortReason.USER_SUPERSEDED.value
    assert aborted[0].content_json["partial_content"] == "I was thinking..."
    assert lock.active_turn(conv_id) is None


@pytest.mark.asyncio
async def test_abort_turn_records_stream_error(
    setup: tuple[SqlConversationRepo, SqlConversationEventRepo, str],
) -> None:
    _, event_repo, conv_id = setup
    lock = TurnLockManager()
    turn = lock.start_turn(conv_id, run_id="r1")
    await lock.abort_turn(
        event_repo,
        conv_id,
        turn,
        reason=TurnAbortReason.STREAM_ERROR,
        error="connection reset",
    )
    events = await event_repo.list_by_conversation(conv_id)
    aborted = [e for e in events if e.kind == EventKind.TURN_ABORTED]
    assert len(aborted) == 1
    assert aborted[0].content_json["reason"] == TurnAbortReason.STREAM_ERROR.value
    assert aborted[0].content_json["error"] == "connection reset"


@pytest.mark.asyncio
async def test_scan_and_close_orphan_turns(
    setup: tuple[SqlConversationRepo, SqlConversationEventRepo, str],
) -> None:
    conv_repo, event_repo, conv_id = setup
    # Simulate a crashed turn: TURN_STARTED with no matching close.
    orphan_tid = "turn-crashed"
    await event_repo.append(
        ConversationEvent(
            id=str(uuid.uuid4()),
            conversation_id=conv_id,
            parent_id=None,
            sequence=await event_repo.next_sequence(conv_id),
            kind=EventKind.TURN_STARTED,
            content_json={"turn_id": orphan_tid},
            turn_id=orphan_tid,
            created_at=datetime.now(UTC),
        )
    )
    # And a healthy turn that DID complete — must not be flagged.
    healthy_tid = "turn-healthy"
    await event_repo.append(
        ConversationEvent(
            id=str(uuid.uuid4()),
            conversation_id=conv_id,
            parent_id=None,
            sequence=await event_repo.next_sequence(conv_id),
            kind=EventKind.TURN_STARTED,
            content_json={"turn_id": healthy_tid},
            turn_id=healthy_tid,
            created_at=datetime.now(UTC),
        )
    )
    await event_repo.append(
        ConversationEvent(
            id=str(uuid.uuid4()),
            conversation_id=conv_id,
            parent_id=None,
            sequence=await event_repo.next_sequence(conv_id),
            kind=EventKind.TURN_COMPLETED,
            content_json={"turn_id": healthy_tid},
            turn_id=healthy_tid,
            created_at=datetime.now(UTC),
        )
    )

    closed = await scan_and_close_orphan_turns(event_repo=event_repo, conversation_repo=conv_repo)
    assert closed == 1

    events = await event_repo.list_by_conversation(conv_id)
    aborted = [e for e in events if e.kind == EventKind.TURN_ABORTED]
    assert len(aborted) == 1
    assert aborted[0].turn_id == orphan_tid
    assert aborted[0].content_json["reason"] == TurnAbortReason.CRASH_RECOVERY.value
