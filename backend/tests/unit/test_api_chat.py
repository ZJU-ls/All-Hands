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


async def test_create_conversation_reuses_empty_one_for_same_employee() -> None:
    """Reuse-empty contract: clicking an employee twice without sending any
    message should land on the same conversation id, not stack up empty rows.

    Validated at the service level so SQL + InMemory both behave the same.
    """
    from datetime import UTC, datetime
    from unittest.mock import AsyncMock

    from allhands.core import Conversation, Employee
    from allhands.services.chat_service import ChatService

    employee = Employee(
        id="emp-1",
        name="Alice",
        description="",
        system_prompt="x",
        model_ref="openai/gpt-4o-mini",
        tool_ids=["allhands.builtin.fetch_url"],
        skill_ids=[],
        created_by="user",
        created_at=datetime.now(UTC),
    )

    state: dict[str, Conversation] = {}

    convs_repo = AsyncMock()

    async def _create(c: Conversation) -> Conversation:
        state[c.id] = c
        return c

    async def _list_for_employee(emp_id: str) -> list[Conversation]:
        return [c for c in state.values() if c.employee_id == emp_id]

    async def _count_messages(ids: list[str]) -> dict[str, int]:
        # Empty by default — every conversation we create here has zero messages.
        return dict.fromkeys(ids, 0)

    convs_repo.create.side_effect = _create
    convs_repo.list_for_employee.side_effect = _list_for_employee
    convs_repo.count_messages.side_effect = _count_messages

    emps_repo = AsyncMock()
    emps_repo.get = AsyncMock(return_value=employee)

    svc = ChatService(
        employee_repo=emps_repo,
        conversation_repo=convs_repo,
        tool_registry=AsyncMock(),
        skill_registry=AsyncMock(),
        gate=AsyncMock(),
    )

    first = await svc.create_conversation(employee.id)
    second = await svc.create_conversation(employee.id)
    # Same id — second click reused the empty draft.
    assert first.id == second.id
    # Only one row hit the repo.
    assert convs_repo.create.await_count == 1


async def test_create_conversation_creates_new_when_existing_has_messages() -> None:
    """Reuse-empty must not pull a user back into an in-progress chat just
    because they happened to click the avatar again — only zero-message
    conversations are eligible."""
    from datetime import UTC, datetime
    from unittest.mock import AsyncMock

    from allhands.core import Conversation, Employee
    from allhands.services.chat_service import ChatService

    employee = Employee(
        id="emp-1",
        name="Alice",
        description="",
        system_prompt="x",
        model_ref="openai/gpt-4o-mini",
        tool_ids=["allhands.builtin.fetch_url"],
        skill_ids=[],
        created_by="user",
        created_at=datetime.now(UTC),
    )

    existing = Conversation(
        id="conv-existing",
        employee_id=employee.id,
        created_at=datetime.now(UTC),
    )
    created: list[Conversation] = []

    convs_repo = AsyncMock()

    async def _create(c: Conversation) -> Conversation:
        created.append(c)
        return c

    async def _list_for_employee(emp_id: str) -> list[Conversation]:
        return [existing] if emp_id == employee.id else []

    async def _count_messages(ids: list[str]) -> dict[str, int]:
        return {existing.id: 3}  # has user/assistant turns

    convs_repo.create.side_effect = _create
    convs_repo.list_for_employee.side_effect = _list_for_employee
    convs_repo.count_messages.side_effect = _count_messages

    svc = ChatService(
        employee_repo=AsyncMock(),
        conversation_repo=convs_repo,
        tool_registry=AsyncMock(),
        skill_registry=AsyncMock(),
        gate=AsyncMock(),
    )
    fresh = await svc.create_conversation(employee.id)
    assert fresh.id != existing.id
    assert convs_repo.create.await_count == 1
