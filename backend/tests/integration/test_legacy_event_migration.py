"""ADR 0017 · P1.E — legacy MessageRepo → event log replay on startup.

Regressions guarded:
- A conversation with only MessageRepo rows gets its messages replayed
  into conversation_events with matching ids and preserved roles.
- Re-running the migration on an already-migrated conversation is a
  no-op (zero events appended).
- ASSISTANT rows preserve tool_calls + render_payloads + reasoning in
  content_json.
- Legacy role="system" rows replay as SUMMARY (compact marker).
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
    Employee,
    EventKind,
    Message,
    RenderPayload,
    ToolCall,
    ToolCallStatus,
)
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import (
    SqlConversationEventRepo,
    SqlConversationRepo,
    SqlEmployeeRepo,
)
from allhands.services.legacy_event_migration import (
    replay_all_legacy_conversations,
    replay_messages_into_events,
)


@pytest.fixture
async def repos() -> AsyncIterator[tuple[SqlConversationRepo, SqlConversationEventRepo, str]]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    emp = Employee(
        id="emp-legacy",
        name="legacy",
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
    async with maker() as session:
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
async def test_replay_converts_user_and_assistant_messages(
    repos: tuple[SqlConversationRepo, SqlConversationEventRepo, str],
) -> None:
    conv_repo, event_repo, conv_id = repos
    # Seed MessageRepo with a typical 2-turn conversation.
    await conv_repo.append_message(
        Message(
            id="m1",
            conversation_id=conv_id,
            role="user",
            content="hi",
            created_at=datetime.now(UTC),
        )
    )
    await conv_repo.append_message(
        Message(
            id="m2",
            conversation_id=conv_id,
            role="assistant",
            content="hello!",
            reasoning="thinking a bit",
            created_at=datetime.now(UTC),
        )
    )

    count = await replay_messages_into_events(
        conversation_repo=conv_repo, event_repo=event_repo, conversation_id=conv_id
    )
    assert count == 2

    events = await event_repo.list_by_conversation(conv_id)
    assert [e.kind for e in events] == [EventKind.USER, EventKind.ASSISTANT]
    assert [e.id for e in events] == ["m1", "m2"]
    assert events[1].content_json["reasoning"] == "thinking a bit"


@pytest.mark.asyncio
async def test_replay_preserves_tool_calls_and_render_payloads(
    repos: tuple[SqlConversationRepo, SqlConversationEventRepo, str],
) -> None:
    conv_repo, event_repo, conv_id = repos
    tc = ToolCall(
        id="tu_1",
        tool_id="calc",
        args={"x": 2},
        status=ToolCallStatus.SUCCEEDED,
        result="4",
    )
    rp = RenderPayload(component="StatCard", props={"value": 42})
    await conv_repo.append_message(
        Message(
            id="m1",
            conversation_id=conv_id,
            role="assistant",
            content="result = 4",
            tool_calls=[tc],
            render_payloads=[rp],
            created_at=datetime.now(UTC),
        )
    )

    count = await replay_messages_into_events(
        conversation_repo=conv_repo, event_repo=event_repo, conversation_id=conv_id
    )
    assert count == 1
    events = await event_repo.list_by_conversation(conv_id)
    assert len(events) == 1
    body = events[0].content_json
    assert body["content"] == "result = 4"
    assert body["tool_calls"][0]["id"] == "tu_1"
    assert body["render_payloads"][0]["component"] == "StatCard"


@pytest.mark.asyncio
async def test_replay_is_idempotent(
    repos: tuple[SqlConversationRepo, SqlConversationEventRepo, str],
) -> None:
    conv_repo, event_repo, conv_id = repos
    await conv_repo.append_message(
        Message(
            id="m1",
            conversation_id=conv_id,
            role="user",
            content="hi",
            created_at=datetime.now(UTC),
        )
    )
    first = await replay_messages_into_events(
        conversation_repo=conv_repo, event_repo=event_repo, conversation_id=conv_id
    )
    assert first == 1
    second = await replay_messages_into_events(
        conversation_repo=conv_repo, event_repo=event_repo, conversation_id=conv_id
    )
    assert second == 0  # idempotent
    events = await event_repo.list_by_conversation(conv_id)
    assert len(events) == 1


@pytest.mark.asyncio
async def test_legacy_system_role_replays_as_summary(
    repos: tuple[SqlConversationRepo, SqlConversationEventRepo, str],
) -> None:
    conv_repo, event_repo, conv_id = repos
    # Legacy compact marker — role="system", content is the compressed
    # narrative. Replay should map it to SUMMARY so context_builder
    # wraps it.
    await conv_repo.append_message(
        Message(
            id="m1",
            conversation_id=conv_id,
            role="system",
            content="User asked about X; assistant answered Y.",
            created_at=datetime.now(UTC),
        )
    )
    count = await replay_messages_into_events(
        conversation_repo=conv_repo, event_repo=event_repo, conversation_id=conv_id
    )
    assert count == 1
    events = await event_repo.list_by_conversation(conv_id)
    assert events[0].kind == EventKind.SUMMARY
    assert events[0].content_json["summary_text"] == "User asked about X; assistant answered Y."


@pytest.mark.asyncio
async def test_replay_all_walks_every_conversation(
    repos: tuple[SqlConversationRepo, SqlConversationEventRepo, str],
) -> None:
    conv_repo, event_repo, conv_id = repos
    # Seed one message for the fixture conversation.
    await conv_repo.append_message(
        Message(
            id="m1",
            conversation_id=conv_id,
            role="user",
            content="hi",
            created_at=datetime.now(UTC),
        )
    )
    convs, events = await replay_all_legacy_conversations(
        conversation_repo=conv_repo, event_repo=event_repo
    )
    assert convs == 1
    assert events == 1
    # Second run: idempotent
    convs2, events2 = await replay_all_legacy_conversations(
        conversation_repo=conv_repo, event_repo=event_repo
    )
    assert convs2 == 0
    assert events2 == 0
