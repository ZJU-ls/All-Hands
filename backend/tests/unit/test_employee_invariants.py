"""Dispatch-mount invariants (agent-design § 7) + default skill injection."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from allhands.core import InvariantViolation
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlEmployeeRepo
from allhands.services.employee_service import (
    DEFAULT_SKILL_IDS,
    DISPATCH_TOOL_ID,
    GET_EMPLOYEE_DETAIL_TOOL_ID,
    LIST_EMPLOYEES_TOOL_ID,
    EmployeeService,
)


@pytest.fixture
async def svc():  # type: ignore[no-untyped-def]
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        yield EmployeeService(SqlEmployeeRepo(session))
    await engine.dispose()


async def test_lead_agent_gets_coordination_tools_auto_injected(svc) -> None:  # type: ignore[no-untyped-def]
    lead = await svc.create(
        name="Lead",
        description="desc",
        system_prompt="p",
        model_ref="openai/gpt-4o-mini",
        tool_ids=[],
        skill_ids=["allhands.render"],
        is_lead_agent=True,
    )
    assert DISPATCH_TOOL_ID in lead.tool_ids
    assert LIST_EMPLOYEES_TOOL_ID in lead.tool_ids
    assert GET_EMPLOYEE_DETAIL_TOOL_ID in lead.tool_ids


async def test_default_skills_injected_when_not_given(svc) -> None:  # type: ignore[no-untyped-def]
    emp = await svc.create(
        name="Worker",
        description="desc",
        system_prompt="p",
        model_ref="openai/gpt-4o-mini",
        tool_ids=["allhands.builtin.fetch_url"],
    )
    assert set(emp.skill_ids) == set(DEFAULT_SKILL_IDS)


async def test_explicit_skill_ids_are_respected(svc) -> None:  # type: ignore[no-untyped-def]
    emp = await svc.create(
        name="Worker",
        description="desc",
        system_prompt="p",
        model_ref="openai/gpt-4o-mini",
        tool_ids=["allhands.builtin.fetch_url"],
        skill_ids=[],  # explicit empty — don't inject
    )
    assert emp.skill_ids == []


async def test_sub_lead_needs_list_and_get_detail(svc) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(InvariantViolation):
        await svc.create(
            name="BadSubLead",
            description="desc",
            system_prompt="p",
            model_ref="openai/gpt-4o-mini",
            tool_ids=[DISPATCH_TOOL_ID],
        )


async def test_sub_lead_allowed_with_full_toolset(svc) -> None:  # type: ignore[no-untyped-def]
    emp = await svc.create(
        name="GoodSubLead",
        description="desc",
        system_prompt="p",
        model_ref="openai/gpt-4o-mini",
        tool_ids=[DISPATCH_TOOL_ID, LIST_EMPLOYEES_TOOL_ID, GET_EMPLOYEE_DETAIL_TOOL_ID],
    )
    assert DISPATCH_TOOL_ID in emp.tool_ids


async def test_update_enforces_invariants(svc) -> None:  # type: ignore[no-untyped-def]
    emp = await svc.create(
        name="Writer",
        description="desc",
        system_prompt="p",
        model_ref="openai/gpt-4o-mini",
        tool_ids=["allhands.builtin.fetch_url"],
    )
    with pytest.raises(InvariantViolation):
        await svc.update(emp.id, tool_ids=[DISPATCH_TOOL_ID])
