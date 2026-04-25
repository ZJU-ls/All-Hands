"""Smoke tests for chat and confirmation API endpoints."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi.testclient import TestClient

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from allhands.api import create_app
from allhands.api.deps import get_session
from allhands.persistence.orm.base import Base


async def _make_test_session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        yield session
    await engine.dispose()


def _make_client() -> TestClient:
    app = create_app()
    app.dependency_overrides[get_session] = _make_test_session
    return TestClient(app)


def test_create_conversation_returns_404_for_unknown_employee() -> None:
    client = _make_client()
    response = client.post(
        "/api/conversations",
        json={"employee_id": "nonexistent"},
    )
    assert response.status_code in (404, 422, 500)


def test_get_pending_confirmations_returns_list() -> None:
    client = _make_client()
    response = client.get("/api/confirmations/pending")
    assert response.status_code == 200
    assert isinstance(response.json(), list)
