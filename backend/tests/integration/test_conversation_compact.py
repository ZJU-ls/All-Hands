"""Track ε — manual context compaction.

Verifies:
  - POST /api/conversations/{id}/compact drops older messages, keeps the last
    N, and inserts a synthetic system-role marker in their place.
  - The marker sorts earlier than the earliest kept message (the chat UI
    renders chronologically, so a marker that surfaces after the kept tail
    would lie about what was removed).
  - Compacting a short conversation is a no-op (dropped = 0).
  - keep_last < 4 is rejected (compaction below that bound has no value — it
    would remove the context the user just sent).
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from allhands.api import create_app
from allhands.api.deps import get_session
from allhands.core import (
    Conversation,
    Employee,
    Message,
    RenderPayload,
    ToolCall,
    ToolCallStatus,
)
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlConversationRepo, SqlEmployeeRepo


def _make_emp() -> Employee:
    return Employee(
        id="emp1",
        name="compact-test",
        description="",
        system_prompt="test-employee",
        model_ref="default",
        tool_ids=[],
        skill_ids=[],
        max_iterations=10,
        is_lead_agent=False,
        created_by="system",
        created_at=datetime.now(UTC),
        metadata={},
    )


def _make_conv() -> Conversation:
    return Conversation(
        id="conv1",
        employee_id="emp1",
        title=None,
        created_at=datetime(2026, 4, 1, tzinfo=UTC),
        metadata={},
    )


def _make_msg(i: int, created_at: datetime) -> Message:
    return Message(
        id=str(uuid.uuid4()),
        conversation_id="conv1",
        role="user" if i % 2 == 0 else "assistant",
        content=f"msg-{i}",
        created_at=created_at,
    )


async def _seed(engine: AsyncEngine, n_messages: int) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        await SqlEmployeeRepo(session).upsert(_make_emp())
        conv_repo = SqlConversationRepo(session)
        await conv_repo.create(_make_conv())
        base = datetime(2026, 4, 1, 12, 0, 0, tzinfo=UTC)
        for i in range(n_messages):
            await conv_repo.append_message(_make_msg(i, base + timedelta(seconds=i)))


@pytest.fixture
def make_client():
    def _build(n_messages: int) -> TestClient:
        engine = create_async_engine(
            "sqlite+aiosqlite:///:memory:",
            poolclass=StaticPool,
            connect_args={"check_same_thread": False},
        )
        asyncio.run(_seed(engine, n_messages))

        async def _session() -> AsyncIterator[AsyncSession]:
            maker = async_sessionmaker(engine, expire_on_commit=False)
            async with maker() as s:
                yield s

        app = create_app()
        app.dependency_overrides[get_session] = _session
        return TestClient(app)

    return _build


def test_compact_drops_older_keeps_tail_and_inserts_marker(make_client) -> None:
    client = make_client(n_messages=30)
    resp = client.post("/api/conversations/conv1/compact", json={"keep_last": 10})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["dropped"] == 20
    assert body["summary_id"] is not None

    messages = body["messages"]
    # 10 kept tail + 1 synthetic marker = 11
    assert len(messages) == 11

    # Marker is chronologically first (so it renders *before* the kept tail).
    assert messages[0]["role"] == "system"
    assert "20" in messages[0]["content"]
    assert "压缩" in messages[0]["content"]

    # Kept tail content is msg-20 … msg-29.
    kept_content = [m["content"] for m in messages[1:]]
    assert kept_content == [f"msg-{i}" for i in range(20, 30)]


def test_compact_noop_when_below_threshold(make_client) -> None:
    client = make_client(n_messages=5)
    resp = client.post("/api/conversations/conv1/compact", json={"keep_last": 10})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["dropped"] == 0
    assert body["summary_id"] is None
    assert len(body["messages"]) == 5


def test_compact_rejects_keep_last_below_four(make_client) -> None:
    client = make_client(n_messages=10)
    resp = client.post("/api/conversations/conv1/compact", json={"keep_last": 2})
    assert resp.status_code == 400
    assert "keep_last" in resp.json()["detail"]


def test_list_messages_endpoint_returns_ordered_history(make_client) -> None:
    client = make_client(n_messages=4)
    resp = client.get("/api/conversations/conv1/messages")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [m["content"] for m in body] == ["msg-0", "msg-1", "msg-2", "msg-3"]
    # Round-trip ISO timestamps so the frontend can Date.parse them.
    for m in body:
        assert m["created_at"].endswith("+00:00") or m["created_at"].endswith("Z")


def test_list_messages_returns_404_for_unknown_conversation(make_client) -> None:
    client = make_client(n_messages=1)
    resp = client.get("/api/conversations/does-not-exist/messages")
    assert resp.status_code == 404


async def _seed_with_render_row(engine: AsyncEngine) -> tuple[str, str]:
    """Seed one assistant message carrying render_payloads + tool_calls +
    reasoning so the endpoint shape can be exercised end-to-end. Returns the
    message_id and tool_call_id so assertions can pin exact fields."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    msg_id = str(uuid.uuid4())
    tc_id = str(uuid.uuid4())
    async with maker() as session:
        await SqlEmployeeRepo(session).upsert(_make_emp())
        conv_repo = SqlConversationRepo(session)
        await conv_repo.create(_make_conv())
        await conv_repo.append_message(
            Message(
                id=msg_id,
                conversation_id="conv1",
                role="assistant",
                content="Here is a chart:",
                reasoning="decided BarChart was the right component",
                render_payloads=[
                    RenderPayload(
                        component="BarChart",
                        props={"bars": [1, 2, 3]},
                    )
                ],
                tool_calls=[
                    ToolCall(
                        id=tc_id,
                        tool_id="allhands.render.bar_chart",
                        args={"title": "Tasks"},
                        status=ToolCallStatus.SUCCEEDED,
                        result={"component": "BarChart", "props": {"bars": [1, 2, 3]}},
                    )
                ],
                created_at=datetime(2026, 4, 22, 12, 0, 0, tzinfo=UTC),
            )
        )
    return msg_id, tc_id


def test_list_messages_endpoint_returns_render_payloads_and_tool_calls() -> None:
    """Historical rehydrate: GET /messages must surface what the DB stored so
    the chat UI redraws charts / cards / tool chips after a reload.
    Bug before fix: ChatMessageResponse silently dropped these fields."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    msg_id, tc_id = asyncio.run(_seed_with_render_row(engine))

    async def _session() -> AsyncIterator[AsyncSession]:
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as s:
            yield s

    app = create_app()
    app.dependency_overrides[get_session] = _session
    client = TestClient(app)

    resp = client.get("/api/conversations/conv1/messages")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body) == 1
    row = body[0]

    assert row["id"] == msg_id
    assert row["content"] == "Here is a chart:"
    assert row["reasoning"] == "decided BarChart was the right component"

    assert len(row["render_payloads"]) == 1
    assert row["render_payloads"][0]["component"] == "BarChart"
    assert row["render_payloads"][0]["props"] == {"bars": [1, 2, 3]}

    assert len(row["tool_calls"]) == 1
    assert row["tool_calls"][0]["id"] == tc_id
    assert row["tool_calls"][0]["tool_id"] == "allhands.render.bar_chart"


def test_compact_response_preserves_render_payloads_on_kept_tail() -> None:
    """Compaction path symmetry: the kept-tail messages returned in the
    compact response must also carry render_payloads / tool_calls / reasoning
    so the store swap on the client doesn't wipe charts the user just saw."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    asyncio.run(_seed_with_render_row(engine))
    # Pad so compact has something to drop; the seeded render row is the
    # newest one so it survives the compaction.
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def _pad() -> None:
        async with maker() as session:
            repo = SqlConversationRepo(session)
            for i in range(10):
                await repo.append_message(
                    Message(
                        id=str(uuid.uuid4()),
                        conversation_id="conv1",
                        role="user" if i % 2 == 0 else "assistant",
                        content=f"pad-{i}",
                        created_at=datetime(2026, 4, 22, 11, i, tzinfo=UTC),
                    )
                )

    asyncio.run(_pad())

    async def _session() -> AsyncIterator[AsyncSession]:
        async with maker() as s:
            yield s

    app = create_app()
    app.dependency_overrides[get_session] = _session
    client = TestClient(app)

    resp = client.post("/api/conversations/conv1/compact", json={"keep_last": 5})
    assert resp.status_code == 200, resp.text
    messages = resp.json()["messages"]
    # The render-carrying assistant row must still be in the kept tail.
    render_rows = [m for m in messages if m.get("render_payloads")]
    assert len(render_rows) == 1
    assert render_rows[0]["render_payloads"][0]["component"] == "BarChart"
