"""End-to-end /api/cockpit flow (Wave C · cockpit spec § 4 / § 11).

Covers the one-shot summary endpoint (asserts shape + seeded counts propagate),
the pause-all confirmation-token gate, resume-all symmetry, and that the
summary reflects pause state after a pause-all.
"""

from __future__ import annotations

import asyncio
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
from allhands.api.deps import (
    get_cockpit_service,
    get_pause_switch,
    get_session,
)
from allhands.core import (
    Employee,
    EventEnvelope,
    Trigger,
    TriggerAction,
    TriggerActionType,
    TriggerKind,
)
from allhands.core.trigger import EventPattern
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import (
    SqlArtifactRepo,
    SqlConfirmationRepo,
    SqlConversationRepo,
    SqlEmployeeRepo,
    SqlEventRepo,
    SqlTriggerRepo,
)
from allhands.services.cockpit_service import CockpitService
from allhands.services.pause_state import PauseSwitch


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
def pause_switch() -> PauseSwitch:
    return PauseSwitch()


@pytest.fixture
def client(
    maker: async_sessionmaker[AsyncSession],
    pause_switch: PauseSwitch,
) -> TestClient:
    async def _session() -> AsyncIterator[AsyncSession]:
        async with maker() as s, s.begin():
            yield s

    async def _cockpit_svc() -> AsyncIterator[CockpitService]:
        async with maker() as s, s.begin():
            yield CockpitService(
                event_repo=SqlEventRepo(s),
                confirmation_repo=SqlConfirmationRepo(s),
                employee_repo=SqlEmployeeRepo(s),
                conversation_repo=SqlConversationRepo(s),
                trigger_repo=SqlTriggerRepo(s),
                artifact_repo=SqlArtifactRepo(s),
                pause_state_provider=pause_switch.snapshot,
            )

    app = create_app()
    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_cockpit_service] = _cockpit_svc
    app.dependency_overrides[get_pause_switch] = lambda: pause_switch
    return TestClient(app)


def _seed(maker: async_sessionmaker[AsyncSession]) -> None:
    now = datetime.now(UTC)

    async def _go() -> None:
        async with maker() as s, s.begin():
            emp_repo = SqlEmployeeRepo(s)
            trig_repo = SqlTriggerRepo(s)
            evt_repo = SqlEventRepo(s)
            await emp_repo.upsert(
                Employee(
                    id="emp-lead",
                    name="lead",
                    description="t",
                    system_prompt="x",
                    model_ref="openai:gpt-4o",
                    tool_ids=["allhands.builtin.render"],
                    created_by="test",
                    created_at=now,
                )
            )
            await trig_repo.upsert(
                Trigger(
                    id="trg-1",
                    name="daily",
                    kind=TriggerKind.EVENT,
                    enabled=True,
                    event=EventPattern(type="run.started"),
                    action=TriggerAction(
                        type=TriggerActionType.DISPATCH_EMPLOYEE,
                        employee_id="emp-lead",
                        task_template="x",
                    ),
                    created_at=now,
                    created_by="tester",
                )
            )
            await evt_repo.save(
                EventEnvelope(
                    id="evt-hello",
                    kind="run.started",
                    payload={"summary": "lead started draft"},
                    published_at=now - timedelta(minutes=1),
                    workspace_id="default",
                )
            )

    asyncio.run(_go())


def test_summary_returns_aggregated_counts_and_recent_events(
    client: TestClient,
    maker: async_sessionmaker[AsyncSession],
) -> None:
    _seed(maker)

    resp = client.get("/api/cockpit/summary")
    assert resp.status_code == 200
    body = resp.json()

    assert body["employees_total"] == 1
    assert body["triggers_active"] == 1
    assert body["runs_active"] == 0
    assert body["paused"] is False

    kinds = [e["kind"] for e in body["recent_events"]]
    assert "run.started" in kinds
    summaries = [e["summary"] for e in body["recent_events"]]
    assert "lead started draft" in summaries


def test_pause_all_without_confirmation_token_is_blocked(
    client: TestClient,
) -> None:
    resp = client.post("/api/cockpit/pause-all", json={"reason": "fire"})
    assert resp.status_code == 412
    assert "Confirmation" in resp.json()["detail"]


def test_pause_all_with_token_then_resume(
    client: TestClient,
) -> None:
    resp = client.post(
        "/api/cockpit/pause-all",
        json={"reason": "drill"},
        headers={"X-Confirmation-Token": "ok"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["paused"] is True
    assert body["reason"] == "drill"
    assert body["already_paused"] is False

    # Calling pause again is idempotent; already_paused=True.
    resp2 = client.post(
        "/api/cockpit/pause-all",
        json={"reason": "second"},
        headers={"X-Confirmation-Token": "ok"},
    )
    assert resp2.status_code == 200
    assert resp2.json()["already_paused"] is True
    # Reason does not change once paused (spec § 4.3 idempotent).
    assert resp2.json()["reason"] == "drill"

    # Summary reflects the pause state.
    summary = client.get("/api/cockpit/summary").json()
    assert summary["paused"] is True
    assert summary["paused_reason"] == "drill"

    # Resume clears.
    resumed = client.post("/api/cockpit/resume-all")
    assert resumed.status_code == 200
    assert resumed.json()["paused"] is False
    summary2 = client.get("/api/cockpit/summary").json()
    assert summary2["paused"] is False
    assert summary2["paused_reason"] is None
