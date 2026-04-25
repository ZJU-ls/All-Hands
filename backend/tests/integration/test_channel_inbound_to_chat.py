"""End-to-end: channel inbound webhook → ConversationService (spec § 8).

Exercises ``build_inbound_handler`` directly — does not go through the full
AgentRunner stream (that needs a real LLM). Instead verifies that:

1. The inbound handler creates a conversation bound to (channel, user_ref).
2. The conversation reuses prior runs for the same user_ref.
3. The handler returns a conversation_id that the caller can write into the
   channel_messages audit row.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from allhands.core.channel import (
    Channel,
    ChannelKind,
    InboundMessage,
)
from allhands.core.employee import Employee
from allhands.persistence.channel_repos import SqlChannelMessageRepo
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlConversationRepo, SqlEmployeeRepo
from allhands.services.channel_inbound import build_inbound_handler


class _FakeChatService:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    async def send_message(self, conversation_id: str, text: str) -> AsyncIterator[dict[str, Any]]:
        self.sent.append((conversation_id, text))

        async def _empty() -> AsyncIterator[dict[str, Any]]:
            if False:
                yield {}

        return _empty()


@pytest.fixture
async def session_and_employee():  # type: ignore[no-untyped-def]
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        emp_repo = SqlEmployeeRepo(session)
        employee = Employee(
            id="emp_lead",
            name="lead",
            description="lead agent",
            system_prompt="hi",
            model_ref="openai:gpt-4o-mini",
            tool_ids=[],
            skill_ids=[],
            max_iterations=3,
            is_lead_agent=True,
            created_by="test",
            created_at=datetime.now(UTC),
        )
        await emp_repo.upsert(employee)
        yield session, employee


@pytest.mark.asyncio
async def test_inbound_creates_new_conversation_then_reuses(session_and_employee):  # type: ignore[no-untyped-def]
    session, _employee = session_and_employee
    chat = _FakeChatService()
    handler = build_inbound_handler(
        chat_service=chat,  # type: ignore[arg-type]
        conversations=SqlConversationRepo(session),
        employees=SqlEmployeeRepo(session),
        messages_repo=SqlChannelMessageRepo(session),
    )
    channel = Channel(
        id="ch_1",
        kind=ChannelKind.TELEGRAM,
        display_name="bot",
        config={},
        inbound_enabled=True,
        outbound_enabled=True,
        webhook_secret=None,
        auto_approve_outbound=False,
        enabled=True,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    inbound_1 = InboundMessage(
        channel_id=channel.id,
        external_user_ref="u-42",
        text="hello",
        received_at=datetime.now(UTC),
        raw={},
    )
    conv_id_1 = await handler(inbound_1, channel)
    assert conv_id_1 is not None
    # Persist an audit row that the 2nd handler call can find
    msg_repo = SqlChannelMessageRepo(session)
    from allhands.core.channel import ChannelDirection, ChannelMessage, ChannelMessageStatus

    await msg_repo.save(
        ChannelMessage(
            id="cm_1",
            channel_id=channel.id,
            direction=ChannelDirection.IN,
            payload={"text": "hello"},
            conversation_id=conv_id_1,
            external_user_ref="u-42",
            status=ChannelMessageStatus.RECEIVED,
            created_at=datetime.now(UTC),
        )
    )

    inbound_2 = InboundMessage(
        channel_id=channel.id,
        external_user_ref="u-42",
        text="follow-up",
        received_at=datetime.now(UTC),
        raw={},
    )
    conv_id_2 = await handler(inbound_2, channel)
    assert conv_id_2 == conv_id_1
    # Both inbound messages routed to the chat service under the same conv
    assert len(chat.sent) == 2
    assert chat.sent[0][0] == conv_id_1
    assert chat.sent[1][0] == conv_id_1


@pytest.mark.asyncio
async def test_inbound_without_employee_returns_none(session_and_employee):  # type: ignore[no-untyped-def]
    session, employee = session_and_employee
    # delete the fixture employee so handler hits the no-employee branch
    await SqlEmployeeRepo(session).delete(employee.id)
    chat = _FakeChatService()
    handler = build_inbound_handler(
        chat_service=chat,  # type: ignore[arg-type]
        conversations=SqlConversationRepo(session),
        employees=SqlEmployeeRepo(session),
        messages_repo=SqlChannelMessageRepo(session),
    )
    channel = Channel(
        id="ch_2",
        kind=ChannelKind.TELEGRAM,
        display_name="bot",
        config={},
        inbound_enabled=True,
        outbound_enabled=True,
        webhook_secret=None,
        auto_approve_outbound=False,
        enabled=True,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    result = await handler(
        InboundMessage(
            channel_id=channel.id,
            external_user_ref="x",
            text="hi",
            received_at=datetime.now(UTC),
            raw={},
        ),
        channel,
    )
    assert result is None
    assert chat.sent == []
