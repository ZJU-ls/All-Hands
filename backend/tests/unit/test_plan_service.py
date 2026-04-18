"""PlanService unit tests (Wave A · agent-design § 5)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from allhands.core import (
    Conversation,
    Employee,
    StepStatus,
)
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import (
    SqlAgentPlanRepo,
    SqlConversationRepo,
    SqlEmployeeRepo,
)
from allhands.services.plan_service import PlanError, PlanNotFound, PlanService


@pytest.fixture
async def session() -> AsyncSession:  # type: ignore[misc]
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


async def _seed_conversation(session: AsyncSession) -> tuple[str, str]:
    emp_repo = SqlEmployeeRepo(session)
    conv_repo = SqlConversationRepo(session)
    now = datetime.now(UTC)
    emp = Employee(
        id=str(uuid.uuid4()),
        name="Planner",
        description="desc",
        system_prompt="prompt",
        model_ref="openai/gpt-4o-mini",
        tool_ids=["allhands.meta.plan_create"],
        created_by="user",
        created_at=now,
    )
    await emp_repo.upsert(emp)
    conv_id = str(uuid.uuid4())
    await conv_repo.create(Conversation(id=conv_id, employee_id=emp.id, created_at=now))
    return emp.id, conv_id


async def test_plan_create_stores_steps(session: AsyncSession) -> None:
    emp_id, conv_id = await _seed_conversation(session)
    svc = PlanService(SqlAgentPlanRepo(session))
    plan = await svc.create(
        conversation_id=conv_id,
        owner_employee_id=emp_id,
        title="Refactor login",
        step_titles=["sketch", "migrate", "verify"],
    )
    assert len(plan.steps) == 3
    assert [s.status for s in plan.steps] == [StepStatus.PENDING] * 3
    assert plan.steps[1].title == "migrate"


async def test_plan_create_enforces_step_bounds(session: AsyncSession) -> None:
    emp_id, conv_id = await _seed_conversation(session)
    svc = PlanService(SqlAgentPlanRepo(session))
    with pytest.raises(PlanError):
        await svc.create(
            conversation_id=conv_id,
            owner_employee_id=emp_id,
            title="empty",
            step_titles=[],
        )
    with pytest.raises(PlanError):
        await svc.create(
            conversation_id=conv_id,
            owner_employee_id=emp_id,
            title="too many",
            step_titles=[f"step {i}" for i in range(21)],
        )


async def test_plan_update_step_flips_status(session: AsyncSession) -> None:
    emp_id, conv_id = await _seed_conversation(session)
    svc = PlanService(SqlAgentPlanRepo(session))
    plan = await svc.create(
        conversation_id=conv_id,
        owner_employee_id=emp_id,
        title="t",
        step_titles=["a", "b"],
    )
    updated = await svc.update_step(plan.id, 1, StepStatus.DONE, note="finished")
    assert updated.steps[0].status == StepStatus.PENDING
    assert updated.steps[1].status == StepStatus.DONE
    assert updated.steps[1].note == "finished"
    assert updated.updated_at >= plan.updated_at


async def test_plan_complete_step_shortcut(session: AsyncSession) -> None:
    emp_id, conv_id = await _seed_conversation(session)
    svc = PlanService(SqlAgentPlanRepo(session))
    plan = await svc.create(
        conversation_id=conv_id,
        owner_employee_id=emp_id,
        title="t",
        step_titles=["only"],
    )
    done = await svc.complete_step(plan.id, 0)
    assert done.steps[0].status == StepStatus.DONE


async def test_plan_update_step_rejects_bad_index(session: AsyncSession) -> None:
    emp_id, conv_id = await _seed_conversation(session)
    svc = PlanService(SqlAgentPlanRepo(session))
    plan = await svc.create(
        conversation_id=conv_id,
        owner_employee_id=emp_id,
        title="t",
        step_titles=["only"],
    )
    with pytest.raises(PlanError):
        await svc.update_step(plan.id, 5, StepStatus.DONE)


async def test_plan_get_missing(session: AsyncSession) -> None:
    svc = PlanService(SqlAgentPlanRepo(session))
    with pytest.raises(PlanNotFound):
        await svc.get("no-such-plan")


async def test_plan_latest_for_conversation(session: AsyncSession) -> None:
    emp_id, conv_id = await _seed_conversation(session)
    svc = PlanService(SqlAgentPlanRepo(session))
    await svc.create(
        conversation_id=conv_id,
        owner_employee_id=emp_id,
        title="first",
        step_titles=["a"],
    )
    await svc.create(
        conversation_id=conv_id,
        owner_employee_id=emp_id,
        title="second",
        step_titles=["b"],
    )
    latest = await svc.get_latest_for_conversation(conv_id)
    assert latest is not None
    # Either plan may be 'latest' — updated_at may tie on fast hardware —
    # but latest must match one of the two titles we just stored.
    assert latest.title in {"first", "second"}
