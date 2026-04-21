"""HTTP contract for ``GET /api/observatory/runs/{run_id}`` (spec 2026-04-21 §4).

Asserts:
- 200 + JSON shape matching ``RunDetailDto`` when the run exists.
- 404 when neither messages nor events exist for the id.
- Successful run has status "succeeded" and reconstructed turns.
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
from allhands.api.deps import get_observatory_service, get_session
from allhands.core import (
    Conversation,
    Employee,
    EventEnvelope,
    Message,
)
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import (
    SqlConversationRepo,
    SqlEmployeeRepo,
    SqlEventRepo,
    SqlObservabilityConfigRepo,
    SqlTaskRepo,
)
from allhands.services.observatory_service import ObservatoryService


async def _init_schema(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


@pytest.fixture
def maker() -> async_sessionmaker[AsyncSession]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    asyncio.run(_init_schema(engine))
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest.fixture
def client(maker: async_sessionmaker[AsyncSession]) -> TestClient:
    async def _session() -> AsyncIterator[AsyncSession]:
        async with maker() as s, s.begin():
            yield s

    async def _svc() -> AsyncIterator[ObservatoryService]:
        async with maker() as s, s.begin():
            yield ObservatoryService(
                event_repo=SqlEventRepo(s),
                employee_repo=SqlEmployeeRepo(s),
                config_repo=SqlObservabilityConfigRepo(s),
                conversation_repo=SqlConversationRepo(s),
                task_repo=SqlTaskRepo(s),
            )

    app = create_app()
    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_observatory_service] = _svc
    return TestClient(app)


def _seed(maker: async_sessionmaker[AsyncSession]) -> str:
    run_id = "run_test_api"
    now = datetime.now(UTC)

    async def _go() -> None:
        async with maker() as s, s.begin():
            emp_repo = SqlEmployeeRepo(s)
            conv_repo = SqlConversationRepo(s)
            evt_repo = SqlEventRepo(s)
            await emp_repo.upsert(
                Employee(
                    id="emp-lead",
                    name="lead",
                    description="t",
                    system_prompt="x",
                    model_ref="openai:gpt-4o",
                    tool_ids=[],
                    created_by="test",
                    created_at=now,
                )
            )
            await conv_repo.create(
                Conversation(id="conv-1", employee_id="emp-lead", created_at=now)
            )
            await conv_repo.append_message(
                Message(
                    id=str(uuid.uuid4()),
                    conversation_id="conv-1",
                    role="user",
                    content="hi",
                    parent_run_id=run_id,
                    created_at=now,
                )
            )
            await conv_repo.append_message(
                Message(
                    id=str(uuid.uuid4()),
                    conversation_id="conv-1",
                    role="assistant",
                    content="hello",
                    reasoning="warmup",
                    parent_run_id=run_id,
                    created_at=now + timedelta(seconds=1),
                )
            )
            await evt_repo.save(
                EventEnvelope(
                    id=f"ev-start-{run_id}",
                    kind="run.started",
                    payload={
                        "run_id": run_id,
                        "employee_id": "emp-lead",
                        "conversation_id": "conv-1",
                    },
                    published_at=now,
                    workspace_id="default",
                    actor="emp-lead",
                )
            )
            await evt_repo.save(
                EventEnvelope(
                    id=f"ev-done-{run_id}",
                    kind="run.completed",
                    payload={
                        "run_id": run_id,
                        "employee_id": "emp-lead",
                        "duration_s": 1.2,
                    },
                    published_at=now + timedelta(seconds=2),
                    workspace_id="default",
                    actor="emp-lead",
                )
            )

    asyncio.run(_go())
    return run_id


def test_get_run_detail_returns_reconstructed_trace(
    client: TestClient, maker: async_sessionmaker[AsyncSession]
) -> None:
    run_id = _seed(maker)
    resp = client.get(f"/api/observatory/runs/{run_id}")
    assert resp.status_code == 200
    body = resp.json()

    assert body["run_id"] == run_id
    assert body["status"] == "succeeded"
    assert body["employee_name"] == "lead"
    assert body["duration_s"] == 1.2
    assert body["conversation_id"] == "conv-1"
    kinds = [t["kind"] for t in body["turns"]]
    assert kinds == ["user_input", "thinking", "message"]
    assert body["turns"][1]["content"] == "warmup"
    assert body["turns"][2]["content"] == "hello"


def test_get_run_detail_returns_404_when_unknown(
    client: TestClient, maker: async_sessionmaker[AsyncSession]
) -> None:
    _seed(maker)
    resp = client.get("/api/observatory/runs/run_does_not_exist")
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()
