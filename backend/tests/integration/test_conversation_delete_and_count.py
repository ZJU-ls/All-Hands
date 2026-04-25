"""History-panel backend contract:

- ``GET /api/conversations`` returns a per-item ``message_count``.
- ``DELETE /api/conversations/{id}`` removes the conversation + cascades.
- ``allhands.meta.delete_conversation`` meta tool is registered (L01).
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

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
from allhands.core import Conversation, Employee, Message
from allhands.execution.registry import ToolRegistry
from allhands.execution.tools import discover_builtin_tools
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlConversationRepo, SqlEmployeeRepo


def _make_emp(emp_id: str, name: str, *, lead: bool = False) -> Employee:
    return Employee(
        id=emp_id,
        name=name,
        description="test",
        system_prompt="you are a tester",
        model_ref="default",
        tool_ids=[],
        skill_ids=[],
        max_iterations=10,
        is_lead_agent=lead,
        created_by="system",
        created_at=datetime.now(UTC),
        metadata={},
    )


def _make_conv(conv_id: str, emp_id: str, *, created_at: datetime) -> Conversation:
    return Conversation(
        id=conv_id,
        title=None,
        employee_id=emp_id,
        created_at=created_at,
        metadata={},
    )


def _make_msg(conv_id: str, role: str, content: str, *, at: datetime) -> Message:
    return Message(
        id=f"msg_{uuid.uuid4().hex[:12]}",
        conversation_id=conv_id,
        role=role,
        content=content,
        created_at=at,
        tool_calls=[],
        render_payloads=[],
    )


async def _seed_async(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session, session.begin():
        await SqlEmployeeRepo(session).upsert(_make_emp("emp_lead", "Lead", lead=True))
        conv_repo = SqlConversationRepo(session)
        await conv_repo.create(
            _make_conv("c1", "emp_lead", created_at=datetime(2026, 4, 1, tzinfo=UTC))
        )
        await conv_repo.create(
            _make_conv("c2", "emp_lead", created_at=datetime(2026, 4, 2, tzinfo=UTC))
        )
        t0 = datetime(2026, 4, 1, 12, 0, 0, tzinfo=UTC)
        await conv_repo.append_message(_make_msg("c1", "user", "hi", at=t0))
        await conv_repo.append_message(_make_msg("c1", "assistant", "hello", at=t0))
        await conv_repo.append_message(_make_msg("c1", "user", "again", at=t0))
        await conv_repo.append_message(_make_msg("c2", "user", "solo", at=t0))


@pytest.fixture
def client() -> TestClient:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    asyncio.run(_seed_async(engine))

    async def _session() -> AsyncIterator[AsyncSession]:
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as s, s.begin():
            yield s

    app = create_app()
    app.dependency_overrides[get_session] = _session
    return TestClient(app)


def test_list_conversations_includes_message_count(client: TestClient) -> None:
    resp = client.get("/api/conversations", params={"employee_id": "emp_lead"})
    assert resp.status_code == 200
    counts = {c["id"]: c["message_count"] for c in resp.json()}
    assert counts == {"c1": 3, "c2": 1}


def test_get_conversation_includes_message_count(client: TestClient) -> None:
    resp = client.get("/api/conversations/c1")
    assert resp.status_code == 200
    assert resp.json()["message_count"] == 3


def test_delete_conversation_cascades_messages(client: TestClient) -> None:
    resp = client.delete("/api/conversations/c1")
    assert resp.status_code == 204, resp.text
    assert client.get("/api/conversations/c1").status_code == 404

    remaining = client.get("/api/conversations", params={"employee_id": "emp_lead"}).json()
    assert [c["id"] for c in remaining] == ["c2"]
    assert remaining[0]["message_count"] == 1


def test_delete_missing_conversation_returns_404(client: TestClient) -> None:
    assert client.delete("/api/conversations/does-not-exist").status_code == 404


def test_delete_conversation_meta_tool_is_registered() -> None:
    registry = ToolRegistry()
    discover_builtin_tools(registry)
    tool_ids = {t.id for t in registry.list_all()}
    assert "allhands.meta.delete_conversation" in tool_ids
