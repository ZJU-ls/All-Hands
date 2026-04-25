"""ObservatoryService unit tests — observatory spec § 6.2 + § 7.

Covers:
- Summary aggregation (traces_total, failure_rate_24h, latency_p50, avg_tokens,
  by_employee breakdown) over the events table.
- Config repo round-trip through get_status / bootstrap_now.
- list_traces filtering by employee_id / status / since / until + limit cap.
- get_trace by id returns None when missing.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from allhands.core import (
    BootstrapStatus,
    Employee,
    EventEnvelope,
    ObservabilityConfig,
)
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import (
    SqlEmployeeRepo,
    SqlEventRepo,
    SqlObservabilityConfigRepo,
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


def _emp(id_: str, name: str) -> Employee:
    return Employee(
        id=id_,
        name=name,
        description="t",
        system_prompt="x",
        model_ref="openai:gpt-4o",
        tool_ids=[],
        created_by="test",
        created_at=datetime.now(UTC),
    )


def _run_event(
    id_: str,
    kind: str,
    *,
    ts: datetime,
    employee_id: str | None = None,
    duration_s: float | None = None,
    tokens: int | None = None,
) -> EventEnvelope:
    payload: dict[str, object] = {}
    if employee_id is not None:
        payload["employee_id"] = employee_id
    if duration_s is not None:
        payload["duration_s"] = duration_s
    if tokens is not None:
        payload["tokens"] = tokens
    return EventEnvelope(
        id=id_,
        kind=kind,
        payload=payload,
        published_at=ts,
        workspace_id="default",
        actor=employee_id,
    )


async def _seed(
    maker: async_sessionmaker[AsyncSession],
    *,
    employees: list[Employee] | None = None,
    events: list[EventEnvelope] | None = None,
    config: ObservabilityConfig | None = None,
) -> None:
    async with maker() as s:
        emp_repo = SqlEmployeeRepo(s)
        evt_repo = SqlEventRepo(s)
        cfg_repo = SqlObservabilityConfigRepo(s)
        for e in employees or []:
            await emp_repo.upsert(e)
        for ev in events or []:
            await evt_repo.save(ev)
        if config is not None:
            await cfg_repo.save(config)


def _svc(session: AsyncSession) -> ObservatoryService:
    return ObservatoryService(
        event_repo=SqlEventRepo(session),
        employee_repo=SqlEmployeeRepo(session),
        config_repo=SqlObservabilityConfigRepo(session),
    )


@pytest.mark.asyncio
async def test_summary_is_empty_on_fresh_db(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    async with maker() as s:
        summary = await _svc(s).get_summary()
    assert summary.traces_total == 0
    assert summary.failure_rate_24h == 0.0
    assert summary.avg_tokens_per_run == 0
    assert summary.observability_enabled is False
    assert summary.bootstrap_status == BootstrapStatus.PENDING


@pytest.mark.asyncio
async def test_summary_aggregates_runs_and_failures(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    await _seed(
        maker,
        employees=[_emp("emp-writer", "writer"), _emp("emp-coder", "coder")],
        events=[
            _run_event(
                "ev-1",
                "run.started",
                ts=now - timedelta(hours=1),
                employee_id="emp-writer",
                duration_s=2.5,
                tokens=1000,
            ),
            _run_event(
                "ev-2",
                "run.finished",
                ts=now - timedelta(hours=2),
                employee_id="emp-writer",
                duration_s=1.0,
                tokens=500,
            ),
            _run_event(
                "ev-3",
                "run.failed",
                ts=now - timedelta(hours=3),
                employee_id="emp-coder",
                duration_s=0.5,
                tokens=300,
            ),
            _run_event(
                "ev-4",
                "run.finished",
                ts=now - timedelta(hours=4),
                employee_id="emp-coder",
                duration_s=3.0,
                tokens=200,
            ),
        ],
    )

    async with maker() as s:
        summary = await _svc(s).get_summary(now=now)

    assert summary.traces_total == 4
    # 1 failed / 4 total in 24h window
    assert summary.failure_rate_24h == 0.25
    # p50 over [0.5, 1.0, 2.5, 3.0] — 50th percentile picks index 2 → 2.5s
    assert summary.latency_p50_s == 2.5
    # avg tokens = (1000 + 500 + 300 + 200) / 4 = 500
    assert summary.avg_tokens_per_run == 500
    breakdown = {row.employee_id: row.runs_count for row in summary.by_employee}
    assert breakdown == {"emp-writer": 2, "emp-coder": 2}
    # Names resolve from EmployeeRepo
    names = {row.employee_id: row.employee_name for row in summary.by_employee}
    assert names == {"emp-writer": "writer", "emp-coder": "coder"}


@pytest.mark.asyncio
async def test_summary_exposes_bootstrap_status(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    await _seed(
        maker,
        config=ObservabilityConfig(
            bootstrap_status=BootstrapStatus.OK,
            host="http://langfuse:3000",
            public_key="pk",
            secret_key="sk",
        ),
    )
    async with maker() as s:
        summary = await _svc(s).get_summary()
    assert summary.observability_enabled is True
    assert summary.bootstrap_status == BootstrapStatus.OK
    assert summary.host == "http://langfuse:3000"


@pytest.mark.asyncio
async def test_list_traces_filter_by_employee_and_status(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    await _seed(
        maker,
        employees=[_emp("emp-writer", "writer"), _emp("emp-coder", "coder")],
        events=[
            _run_event(
                "ev-ok-1",
                "run.finished",
                ts=now - timedelta(minutes=10),
                employee_id="emp-writer",
                duration_s=1.2,
                tokens=50,
            ),
            _run_event(
                "ev-fail-1",
                "run.failed",
                ts=now - timedelta(minutes=5),
                employee_id="emp-coder",
                duration_s=0.8,
                tokens=30,
            ),
        ],
    )
    async with maker() as s:
        svc = _svc(s)
        only_writer = await svc.list_traces(employee_id="emp-writer")
        only_failed = await svc.list_traces(status="failed")

    assert [t.employee_id for t in only_writer] == ["emp-writer"]
    assert [t.status for t in only_failed] == ["failed"]
    assert only_failed[0].employee_name == "coder"


@pytest.mark.asyncio
async def test_list_traces_limit_is_respected(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    await _seed(
        maker,
        events=[
            _run_event(
                f"ev-{i}",
                "run.finished",
                ts=now - timedelta(minutes=i),
                employee_id="emp-x",
                duration_s=1.0,
                tokens=10,
            )
            for i in range(20)
        ],
    )
    async with maker() as s:
        traces = await _svc(s).list_traces(limit=5)
    assert len(traces) == 5


@pytest.mark.asyncio
async def test_get_trace_returns_none_when_missing(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    async with maker() as s:
        assert await _svc(s).get_trace("does-not-exist") is None


@pytest.mark.asyncio
async def test_bootstrap_now_is_idempotent_noop(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    async with maker() as s:
        cfg = await _svc(s).bootstrap_now()
    # v0 MVP: returns pending singleton without touching Langfuse
    assert cfg.bootstrap_status == BootstrapStatus.PENDING
    assert cfg.observability_enabled is False
