"""ADR 0019 C1 · GET /api/conversations/{id}/plans/latest endpoint.

Powers the ProgressPanel.plan section in chat UI. Returns null (200) when
no plan exists yet — frontend treats null as "hide section".
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from allhands.api import create_app
from allhands.api.deps import get_session
from allhands.core.plan import AgentPlan, PlanStep, StepStatus
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlAgentPlanRepo


@pytest.fixture
def setup(tmp_path: Path) -> tuple[TestClient, async_sessionmaker[AsyncSession]]:
    """File-backed SQLite — TestClient and direct-DB seeding share the
    same loop / connection per call; the file persists across the test
    so seed data is visible to the HTTP request."""
    db_path = tmp_path / "plans-test.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def _create_tables() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_create_tables())

    async def _override_session() -> AsyncIterator[AsyncSession]:
        async with maker() as s:
            yield s

    app = create_app()
    app.dependency_overrides[get_session] = _override_session
    return TestClient(app), maker


async def _seed_plans(
    maker: async_sessionmaker[AsyncSession],
    conversation_id: str,
) -> None:
    now = datetime.now(UTC)
    async with maker() as s:
        repo = SqlAgentPlanRepo(s)
        await repo.upsert(
            AgentPlan(
                id=str(uuid.uuid4()),
                conversation_id=conversation_id,
                run_id=None,
                owner_employee_id="emp-1",
                title="老 plan",
                steps=[PlanStep(index=0, title="x")],
                created_at=now.replace(microsecond=1),
                updated_at=now.replace(microsecond=1),
            )
        )
        await repo.upsert(
            AgentPlan(
                id="plan-latest",
                conversation_id=conversation_id,
                run_id=None,
                owner_employee_id="emp-1",
                title="新 plan",
                steps=[
                    PlanStep(index=0, title="第一步", status=StepStatus.DONE),
                    PlanStep(index=1, title="第二步", status=StepStatus.RUNNING),
                    PlanStep(index=2, title="第三步"),
                ],
                created_at=now.replace(microsecond=999),
                updated_at=now.replace(microsecond=999),
            )
        )


def test_plans_latest_returns_null_when_no_plan(
    setup: tuple[TestClient, async_sessionmaker[AsyncSession]],
) -> None:
    client, _ = setup
    r = client.get("/api/conversations/conv-empty/plans/latest")
    assert r.status_code == 200
    assert r.json() is None


def test_plans_latest_returns_latest_plan_with_steps(
    setup: tuple[TestClient, async_sessionmaker[AsyncSession]],
) -> None:
    client, maker = setup
    conv = "conv-with-plan"
    asyncio.run(_seed_plans(maker, conv))

    r = client.get(f"/api/conversations/{conv}/plans/latest")
    assert r.status_code == 200
    body = r.json()
    assert body is not None
    assert body["plan_id"] == "plan-latest"
    assert body["title"] == "新 plan"
    assert len(body["steps"]) == 3
    assert body["steps"][0]["status"] == "done"
    assert body["steps"][1]["status"] == "running"
    assert body["steps"][2]["status"] == "pending"
    assert "created_at" in body and "updated_at" in body


def test_plans_latest_unknown_conversation_returns_null(
    setup: tuple[TestClient, async_sessionmaker[AsyncSession]],
) -> None:
    """A conversation id that doesn't exist in the plan table simply has
    no plan — return null (not 404). Lets the UI show an empty Progress
    panel without an error toast."""
    client, _ = setup
    r = client.get("/api/conversations/totally-unknown/plans/latest")
    assert r.status_code == 200
    assert r.json() is None
