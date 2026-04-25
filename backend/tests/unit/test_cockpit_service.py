"""CockpitService unit tests — cockpit spec § 11 / § 3.

Covers WorkspaceSummary aggregation: KPI counts, recent-events projection
filtered by kind prefix + workspace_id, active-runs pass-through from the
injected provider, pause-state pass-through, and confirmations pending count.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
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
    ActiveRunCard,
    Artifact,
    ArtifactKind,
    ComponentStatus,
    Confirmation,
    ConfirmationStatus,
    Conversation,
    Employee,
    EventEnvelope,
    EventPattern,
    HealthSnapshot,
    Trigger,
    TriggerAction,
    TriggerActionType,
    TriggerKind,
)
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import (
    SqlArtifactRepo,
    SqlConfirmationRepo,
    SqlConversationRepo,
    SqlEmployeeRepo,
    SqlEventRepo,
    SqlTaskRepo,
    SqlTriggerRepo,
)
from allhands.services.cockpit_service import (
    CockpitService,
    PauseState,
    TokenStats,
)
from allhands.services.task_service import TaskService


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
        tool_ids=["allhands.builtin.render"],
        created_by="test",
        created_at=datetime.now(UTC),
    )


def _conv(id_: str, emp_id: str, *, created_at: datetime, title: str = "t") -> Conversation:
    return Conversation(
        id=id_,
        title=title,
        employee_id=emp_id,
        created_at=created_at,
    )


def _trigger(id_: str, *, enabled: bool) -> Trigger:
    return Trigger(
        id=id_,
        name=f"trig-{id_}",
        kind=TriggerKind.EVENT,
        enabled=enabled,
        event=EventPattern(type="run.started"),
        action=TriggerAction(
            type=TriggerActionType.DISPATCH_EMPLOYEE,
            employee_id="emp-1",
            task_template="x",
        ),
        created_at=datetime.now(UTC),
        created_by="tester",
    )


def _artifact(id_: str, name: str, *, created_at: datetime) -> Artifact:
    return Artifact(
        id=id_,
        workspace_id="default",
        name=name,
        kind=ArtifactKind.MARKDOWN,
        mime_type="text/markdown",
        file_path=f"default/{id_}/v1.md",
        size_bytes=10,
        version=1,
        pinned=False,
        deleted_at=None,
        created_at=created_at,
        updated_at=created_at,
    )


def _event(
    id_: str,
    kind: str,
    *,
    ts: datetime,
    workspace_id: str = "default",
    severity: str = "info",
    summary: str | None = None,
) -> EventEnvelope:
    return EventEnvelope(
        id=id_,
        kind=kind,
        payload={"summary": summary} if summary else {},
        published_at=ts,
        workspace_id=workspace_id,
        severity=severity,
    )


async def _seed(
    maker: async_sessionmaker[AsyncSession],
    *,
    employees: list[Employee] = (),  # type: ignore[assignment]
    conversations: list[Conversation] = (),  # type: ignore[assignment]
    triggers: list[Trigger] = (),  # type: ignore[assignment]
    artifacts: list[Artifact] = (),  # type: ignore[assignment]
    events: list[EventEnvelope] = (),  # type: ignore[assignment]
    confirmations: list[Confirmation] = (),  # type: ignore[assignment]
) -> None:
    async with maker() as s:
        emp_repo = SqlEmployeeRepo(s)
        conv_repo = SqlConversationRepo(s)
        trig_repo = SqlTriggerRepo(s)
        art_repo = SqlArtifactRepo(s)
        evt_repo = SqlEventRepo(s)
        conf_repo = SqlConfirmationRepo(s)
        for e in employees:
            await emp_repo.upsert(e)
        for c in conversations:
            await conv_repo.create(c)
        for t in triggers:
            await trig_repo.upsert(t)
        for a in artifacts:
            await art_repo.upsert(a)
        for ev in events:
            await evt_repo.save(ev)
        for cf in confirmations:
            await conf_repo.save(cf)


def _svc(session: AsyncSession, **overrides: object) -> CockpitService:
    defaults: dict[str, object] = {
        "event_repo": SqlEventRepo(session),
        "confirmation_repo": SqlConfirmationRepo(session),
        "employee_repo": SqlEmployeeRepo(session),
        "conversation_repo": SqlConversationRepo(session),
        "trigger_repo": SqlTriggerRepo(session),
        "artifact_repo": SqlArtifactRepo(session),
        "task_repo": SqlTaskRepo(session),
    }
    defaults.update(overrides)
    return CockpitService(**defaults)  # type: ignore[arg-type]


async def _in_session(
    maker: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    async with maker() as s:
        yield s


async def test_empty_workspace_produces_zero_kpis(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    async with maker() as s:
        svc = _svc(s)
        summary = await svc.build_summary()
    assert summary.employees_total == 0
    assert summary.runs_active == 0
    assert summary.conversations_today == 0
    assert summary.artifacts_total == 0
    assert summary.triggers_active == 0
    assert summary.confirmations_pending == 0
    assert summary.recent_events == []
    assert summary.active_runs == []
    assert summary.paused is False


async def test_aggregates_counts_from_repos(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    yesterday = now - timedelta(hours=25)
    this_hour = now - timedelta(minutes=5)

    await _seed(
        maker,
        employees=[_emp("e1", "lead"), _emp("e2", "coder")],
        conversations=[
            _conv("c1", "e1", created_at=this_hour),  # today
            _conv("c2", "e2", created_at=yesterday),  # older, not today
        ],
        triggers=[_trigger("t-on", enabled=True), _trigger("t-off", enabled=False)],
        artifacts=[_artifact("a1", "plan.md", created_at=this_hour)],
    )

    async with maker() as s:
        svc = _svc(s)
        summary = await svc.build_summary(now=now)

    assert summary.employees_total == 2
    assert summary.conversations_today == 1
    assert summary.triggers_active == 1
    assert summary.artifacts_total == 1
    assert summary.artifacts_this_week_delta == 1


async def test_recent_events_filtered_by_kind_prefix_and_workspace(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    events = [
        _event("evt-run", "run.started", ts=now - timedelta(minutes=1), summary="lead 开始写草稿"),
        _event("evt-art", "artifact.created", ts=now - timedelta(minutes=2)),
        # unknown prefix → filtered out
        _event("evt-junk", "system.boot", ts=now - timedelta(minutes=3)),
        # other workspace → filtered out
        _event("evt-other", "run.started", ts=now - timedelta(minutes=4), workspace_id="other"),
    ]
    await _seed(maker, events=events)

    async with maker() as s:
        svc = _svc(s)
        summary = await svc.build_summary(now=now)

    ids = [e.id for e in summary.recent_events]
    assert "evt-run" in ids
    assert "evt-art" in ids
    assert "evt-junk" not in ids
    assert "evt-other" not in ids
    # payload summary propagates through
    first = next(e for e in summary.recent_events if e.id == "evt-run")
    assert first.summary == "lead 开始写草稿"


async def test_runs_failing_recently_counts_last_hour(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    await _seed(
        maker,
        events=[
            _event("f1", "run.failed", ts=now - timedelta(minutes=10)),
            _event("f2", "run.failed", ts=now - timedelta(minutes=30)),
            _event("f-old", "run.failed", ts=now - timedelta(hours=2)),  # excluded
            _event("ok", "run.completed", ts=now - timedelta(minutes=5)),  # excluded
        ],
    )

    async with maker() as s:
        svc = _svc(s)
        summary = await svc.build_summary(now=now)

    assert summary.runs_failing_recently == 2


async def test_active_runs_and_health_come_from_providers(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    started_at = datetime.now(UTC)
    card = ActiveRunCard(
        run_id="run-42",
        employee_id="e1",
        employee_name="lead",
        status="thinking",
        current_action_summary="调用 search",
        iteration=2,
        max_iterations=10,
        started_at=started_at,
    )
    health = HealthSnapshot(
        gateway=ComponentStatus(name="gateway", status="degraded", detail="3/4 online"),
        mcp_servers=ComponentStatus(name="mcp", status="ok"),
        langfuse=ComponentStatus(name="langfuse", status="degraded", detail="paused"),
        db=ComponentStatus(name="db", status="ok"),
        triggers=ComponentStatus(name="triggers", status="ok", detail="1 paused"),
    )

    async with maker() as s:
        svc = _svc(
            s,
            active_runs_provider=lambda: [card],
            health_provider=lambda: health,
            pause_state_provider=lambda: PauseState(
                paused=True, reason="emergency", paused_at=started_at
            ),
        )
        summary = await svc.build_summary()

    assert summary.runs_active == 1
    assert summary.active_runs == [card]
    assert summary.health.gateway.status == "degraded"
    assert summary.health.langfuse.detail == "paused"
    assert summary.paused is True
    assert summary.paused_reason == "emergency"


async def test_confirmations_pending_counts_pending_only(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    expires = now + timedelta(minutes=5)
    confs = [
        Confirmation(
            id="cf1",
            tool_call_id="tc1",
            rationale="agent wants to write",
            summary="write file x",
            status=ConfirmationStatus.PENDING,
            created_at=now,
            expires_at=expires,
        ),
        Confirmation(
            id="cf2",
            tool_call_id="tc2",
            rationale="agent wants to write",
            summary="write file y",
            status=ConfirmationStatus.APPROVED,
            created_at=now,
            resolved_at=now,
            expires_at=expires,
        ),
    ]
    await _seed(maker, confirmations=confs)

    async with maker() as s:
        svc = _svc(s)
        summary = await svc.build_summary(now=now)

    assert summary.confirmations_pending == 1


async def test_tasks_kpis_populate_from_task_service(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    """Cockpit summary exposes tasks_active + tasks_needs_user counts.

    Spec `docs/specs/agent-design/2026-04-18-tasks.md` § 7.1:
    cockpit KPI bar must show how many tasks are running and how many
    need the user.
    """
    from allhands.core import TaskSource

    async with maker() as s:
        tsvc = TaskService(SqlTaskRepo(s))
        t1 = await tsvc.create(
            title="queued-task",
            goal="g",
            dod="d",
            assignee_id="e1",
            source=TaskSource.USER,
            created_by="user",
        )
        t2 = await tsvc.create(
            title="running-task",
            goal="g",
            dod="d",
            assignee_id="e1",
            source=TaskSource.USER,
            created_by="user",
        )
        await tsvc.start(t2.id, run_id="r-1")
        t3 = await tsvc.create(
            title="needs-input-task",
            goal="g",
            dod="d",
            assignee_id="e1",
            source=TaskSource.USER,
            created_by="user",
        )
        await tsvc.start(t3.id, run_id="r-2")
        await tsvc.request_input(t3.id, "what should the tone be?")
        # completed task should NOT count toward active
        t4 = await tsvc.create(
            title="done-task",
            goal="g",
            dod="d",
            assignee_id="e1",
            source=TaskSource.USER,
            created_by="user",
        )
        await tsvc.start(t4.id, run_id="r-3")
        await tsvc.complete(t4.id, result_summary="shipped")
        # silence unused warnings
        _ = t1

    async with maker() as s:
        svc = _svc(s)
        summary = await svc.build_summary()

    # t1(queued) + t2(running) + t3(needs_input) = 3 active; t4(completed) excluded
    assert summary.tasks_active == 3
    # only t3 needs user input/approval
    assert summary.tasks_needs_user == 1


async def test_token_stats_provider_feeds_kpi(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)

    async def tokens(_since: datetime) -> TokenStats:
        return TokenStats(prompt=100, completion=200, estimated_cost_usd=0.0123)

    async with maker() as s:
        svc = _svc(s, token_stats_provider=tokens)
        summary = await svc.build_summary(now=now)

    assert summary.tokens_today_prompt == 100
    assert summary.tokens_today_completion == 200
    assert summary.tokens_today_total == 300
    assert summary.estimated_cost_today_usd == pytest.approx(0.0123)
