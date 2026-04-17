"""Integration-style tests for SQL repositories (use in-memory SQLite)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from allhands.core import (
    Confirmation,
    ConfirmationStatus,
    Conversation,
    Employee,
    Message,
    Skill,
)
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import (
    SqlConfirmationRepo,
    SqlConversationRepo,
    SqlEmployeeRepo,
    SqlSkillRepo,
)


@pytest.fixture
async def session() -> AsyncSession:  # type: ignore[misc]
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


def _employee(**kw: object) -> Employee:
    now = datetime.now(UTC)
    defaults: dict[str, object] = {
        "id": str(uuid.uuid4()),
        "name": "Researcher",
        "description": "desc",
        "system_prompt": "You are helpful.",
        "model_ref": "openai/gpt-4o-mini",
        "created_by": "user",
        "created_at": now,
        "tool_ids": ["allhands.builtin.fetch_url"],
    }
    defaults.update(kw)
    return Employee(**defaults)


async def test_employee_upsert_and_get(session: AsyncSession) -> None:
    repo = SqlEmployeeRepo(session)
    emp = _employee()
    await repo.upsert(emp)
    fetched = await repo.get(emp.id)
    assert fetched is not None
    assert fetched.id == emp.id
    assert fetched.name == emp.name
    assert fetched.tool_ids == emp.tool_ids


async def test_employee_get_by_name(session: AsyncSession) -> None:
    repo = SqlEmployeeRepo(session)
    emp = _employee(name="Writer")
    await repo.upsert(emp)
    fetched = await repo.get_by_name("Writer")
    assert fetched is not None
    assert fetched.id == emp.id


async def test_employee_get_lead(session: AsyncSession) -> None:
    repo = SqlEmployeeRepo(session)
    lead = _employee(name="Lead", is_lead_agent=True)
    await repo.upsert(lead)
    fetched = await repo.get_lead()
    assert fetched is not None
    assert fetched.is_lead_agent is True


async def test_employee_list_all(session: AsyncSession) -> None:
    repo = SqlEmployeeRepo(session)
    await repo.upsert(_employee(id="e1", name="Alice"))
    await repo.upsert(_employee(id="e2", name="Bob"))
    employees = await repo.list_all()
    assert len(employees) == 2


async def test_employee_delete(session: AsyncSession) -> None:
    repo = SqlEmployeeRepo(session)
    emp = _employee()
    await repo.upsert(emp)
    await repo.delete(emp.id)
    assert await repo.get(emp.id) is None


async def test_conversation_create_and_list_messages(session: AsyncSession) -> None:
    emp_repo = SqlEmployeeRepo(session)
    emp = _employee()
    await emp_repo.upsert(emp)

    conv_repo = SqlConversationRepo(session)
    now = datetime.now(UTC)
    conv = Conversation(id="c1", employee_id=emp.id, created_at=now)
    await conv_repo.create(conv)

    msg = Message(
        id="m1",
        conversation_id="c1",
        role="user",
        content="hello",
        created_at=now,
    )
    await conv_repo.append_message(msg)

    messages = await conv_repo.list_messages("c1")
    assert len(messages) == 1
    assert messages[0].content == "hello"


async def test_confirmation_save_and_update(session: AsyncSession) -> None:
    repo = SqlConfirmationRepo(session)
    now = datetime.now(UTC)
    conf = Confirmation(
        id="cf1",
        tool_call_id="tc1",
        rationale="dangerous op",
        summary="delete employee Alice",
        status=ConfirmationStatus.PENDING,
        created_at=now,
        expires_at=now + timedelta(minutes=5),
    )
    await repo.save(conf)
    fetched = await repo.get("cf1")
    assert fetched is not None
    assert fetched.status == ConfirmationStatus.PENDING

    await repo.update_status("cf1", ConfirmationStatus.APPROVED)
    fetched2 = await repo.get("cf1")
    assert fetched2 is not None
    assert fetched2.status == ConfirmationStatus.APPROVED


async def test_skill_upsert_and_list(session: AsyncSession) -> None:
    repo = SqlSkillRepo(session)
    skill = Skill(
        id="sk_research",
        name="web_research",
        description="research the web",
        tool_ids=["allhands.builtin.fetch_url"],
        prompt_fragment="Research thoroughly.",
        version="0.1.0",
    )
    await repo.upsert(skill)
    skills = await repo.list_all()
    assert len(skills) == 1
    assert skills[0].id == "sk_research"
