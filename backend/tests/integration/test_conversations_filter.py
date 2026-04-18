"""End-to-end tests for GET /api/conversations employee filter (spec 2026-04-18-employee-chat § 9)."""

from __future__ import annotations

import asyncio
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
from allhands.core import Conversation, Employee
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


def _make_conv(conv_id: str, emp_id: str, title: str, *, created_at: datetime) -> Conversation:
    return Conversation(
        id=conv_id,
        title=title,
        employee_id=emp_id,
        created_at=created_at,
        metadata={},
    )


async def _seed_async(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session, session.begin():
        await SqlEmployeeRepo(session).upsert(_make_emp("emp_lead", "Lead", lead=True))
        await SqlEmployeeRepo(session).upsert(_make_emp("emp_writer", "Writer"))
        conv_repo = SqlConversationRepo(session)
        await conv_repo.create(
            _make_conv("c1", "emp_lead", "lead a", created_at=datetime(2026, 4, 1, tzinfo=UTC))
        )
        await conv_repo.create(
            _make_conv("c2", "emp_writer", "w old", created_at=datetime(2026, 4, 2, tzinfo=UTC))
        )
        await conv_repo.create(
            _make_conv("c3", "emp_writer", "w new", created_at=datetime(2026, 4, 3, tzinfo=UTC))
        )


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


def test_default_returns_lead_conversations(client: TestClient) -> None:
    resp = client.get("/api/conversations")
    assert resp.status_code == 200
    data = resp.json()
    assert [c["id"] for c in data] == ["c1"]
    assert data[0]["employee_id"] == "emp_lead"


def test_filter_by_employee_id(client: TestClient) -> None:
    resp = client.get("/api/conversations", params={"employee_id": "emp_writer"})
    assert resp.status_code == 200
    data = resp.json()
    assert [c["id"] for c in data] == ["c3", "c2"]  # newest first
    assert all(c["employee_id"] == "emp_writer" for c in data)


def test_filter_all_returns_every_conversation_newest_first(client: TestClient) -> None:
    resp = client.get("/api/conversations", params={"employee_id": "all"})
    assert resp.status_code == 200
    data = resp.json()
    assert [c["id"] for c in data] == ["c3", "c2", "c1"]


def test_filter_unknown_employee_returns_404(client: TestClient) -> None:
    resp = client.get("/api/conversations", params={"employee_id": "emp_ghost"})
    assert resp.status_code == 404
    assert "emp_ghost" in resp.json()["detail"]
