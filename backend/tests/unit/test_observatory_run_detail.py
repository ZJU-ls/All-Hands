"""ObservatoryService.get_run_detail unit tests — spec 2026-04-21 §3.2 + §9.1.

Reconstruct Turn[] from persisted messages + run.* events. Each test focuses
on one of the spec's enumerated cases: empty history, user-only, user +
assistant message, thinking channel, tool_call paired with tool result,
orphan tool_call, missing run.
"""

from __future__ import annotations

import asyncio
import uuid
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
    ACTIVE_STATUSES,  # noqa: F401  (keeps core import surface stable)
    Conversation,
    Employee,
    EventEnvelope,
    Message,
    RunStatus,
    Task,
    TaskSource,
    TaskStatus,
    ToolCall,
    ToolCallStatus,
    TurnMessage,
    TurnThinking,
    TurnToolCall,
    TurnUserInput,
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


def _svc(session: AsyncSession) -> ObservatoryService:
    return ObservatoryService(
        event_repo=SqlEventRepo(session),
        employee_repo=SqlEmployeeRepo(session),
        config_repo=SqlObservabilityConfigRepo(session),
        conversation_repo=SqlConversationRepo(session),
        task_repo=SqlTaskRepo(session),
    )


def _employee() -> Employee:
    return Employee(
        id="emp-lead",
        name="lead",
        description="t",
        system_prompt="x",
        model_ref="openai:gpt-4o",
        tool_ids=[],
        created_by="test",
        created_at=datetime.now(UTC),
    )


def _conversation(conv_id: str = "conv-1", employee_id: str = "emp-lead") -> Conversation:
    return Conversation(
        id=conv_id,
        employee_id=employee_id,
        created_at=datetime.now(UTC),
    )


def _run_started(run_id: str, *, ts: datetime, employee_id: str = "emp-lead") -> EventEnvelope:
    return EventEnvelope(
        id=f"ev-start-{run_id}",
        kind="run.started",
        payload={"run_id": run_id, "employee_id": employee_id, "conversation_id": "conv-1"},
        published_at=ts,
        workspace_id="default",
        actor=employee_id,
    )


def _run_completed(
    run_id: str,
    *,
    ts: datetime,
    duration_s: float = 1.0,
    employee_id: str = "emp-lead",
    tokens: int | dict[str, int] | None = None,
) -> EventEnvelope:
    payload: dict[str, object] = {
        "run_id": run_id,
        "employee_id": employee_id,
        "duration_s": duration_s,
    }
    if tokens is not None:
        payload["tokens"] = tokens
    return EventEnvelope(
        id=f"ev-done-{run_id}",
        kind="run.completed",
        payload=payload,
        published_at=ts,
        workspace_id="default",
        actor=employee_id,
    )


def _run_failed(
    run_id: str, *, ts: datetime, error: str = "boom", employee_id: str = "emp-lead"
) -> EventEnvelope:
    return EventEnvelope(
        id=f"ev-fail-{run_id}",
        kind="run.failed",
        payload={
            "run_id": run_id,
            "employee_id": employee_id,
            "error": error,
            "error_kind": "tool_error",
        },
        published_at=ts,
        workspace_id="default",
        actor=employee_id,
    )


async def _seed(
    maker: async_sessionmaker[AsyncSession],
    *,
    messages: list[Message] | None = None,
    events: list[EventEnvelope] | None = None,
    tasks: list[Task] | None = None,
    conversation: Conversation | None = None,
    employees: list[Employee] | None = None,
) -> None:
    async with maker() as s:
        emp_repo = SqlEmployeeRepo(s)
        evt_repo = SqlEventRepo(s)
        conv_repo = SqlConversationRepo(s)
        task_repo = SqlTaskRepo(s)
        for e in employees or [_employee()]:
            await emp_repo.upsert(e)
        if conversation is not None:
            await conv_repo.create(conversation)
        else:
            await conv_repo.create(_conversation())
        for m in messages or []:
            await conv_repo.append_message(m)
        for ev in events or []:
            await evt_repo.save(ev)
        for t in tasks or []:
            await task_repo.upsert(t)


def _msg(
    *,
    role: str,
    content: str,
    run_id: str | None,
    ts: datetime,
    reasoning: str | None = None,
    tool_calls: list[ToolCall] | None = None,
    tool_call_id: str | None = None,
    conv_id: str = "conv-1",
) -> Message:
    return Message(
        id=str(uuid.uuid4()),
        conversation_id=conv_id,
        role=role,  # type: ignore[arg-type]
        content=content,
        tool_calls=tool_calls or [],
        tool_call_id=tool_call_id,
        parent_run_id=run_id,
        reasoning=reasoning,
        created_at=ts,
    )


@pytest.mark.asyncio
async def test_returns_none_when_unknown_run(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    await _seed(maker)
    async with maker() as s:
        assert await _svc(s).get_run_detail("run_does_not_exist") is None


@pytest.mark.asyncio
async def test_user_plus_plain_assistant_answer(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    run = "run_abc"
    await _seed(
        maker,
        messages=[
            _msg(role="user", content="hi", run_id=run, ts=now),
            _msg(
                role="assistant",
                content="hello there",
                run_id=run,
                ts=now + timedelta(seconds=1),
            ),
        ],
        events=[
            _run_started(run, ts=now),
            _run_completed(run, ts=now + timedelta(seconds=2), duration_s=2.0),
        ],
    )
    async with maker() as s:
        detail = await _svc(s).get_run_detail(run)

    assert detail is not None
    assert detail.run_id == run
    assert detail.status == RunStatus.SUCCEEDED
    assert detail.duration_s == 2.0
    assert detail.employee_name == "lead"
    kinds = [t.kind for t in detail.turns]
    assert kinds == ["user_input", "message"]
    assert isinstance(detail.turns[0], TurnUserInput)
    assert detail.turns[0].content == "hi"
    assert isinstance(detail.turns[1], TurnMessage)
    assert detail.turns[1].content == "hello there"


@pytest.mark.asyncio
async def test_assistant_with_reasoning_emits_thinking_before_message(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    run = "run_think"
    await _seed(
        maker,
        messages=[
            _msg(role="user", content="q", run_id=run, ts=now),
            _msg(
                role="assistant",
                content="final answer",
                reasoning="step 1 · step 2",
                run_id=run,
                ts=now + timedelta(seconds=1),
            ),
        ],
        events=[_run_completed(run, ts=now + timedelta(seconds=2))],
    )
    async with maker() as s:
        detail = await _svc(s).get_run_detail(run)

    assert detail is not None
    kinds = [t.kind for t in detail.turns]
    assert kinds == ["user_input", "thinking", "message"]
    assert isinstance(detail.turns[1], TurnThinking)
    assert detail.turns[1].content == "step 1 · step 2"


@pytest.mark.asyncio
async def test_tool_call_pairs_with_following_tool_result(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    run = "run_tool"
    tc = ToolCall(
        id="tc-1",
        tool_id="fetch_url",
        args={"url": "https://example.com"},
        status=ToolCallStatus.RUNNING,
    )
    await _seed(
        maker,
        messages=[
            _msg(role="user", content="fetch it", run_id=run, ts=now),
            _msg(
                role="assistant",
                content="",
                run_id=run,
                ts=now + timedelta(seconds=1),
                tool_calls=[tc],
            ),
            _msg(
                role="tool",
                content='{"title": "hi"}',
                run_id=run,
                ts=now + timedelta(seconds=2),
                tool_call_id="tc-1",
            ),
            _msg(
                role="assistant",
                content="the page title is hi",
                run_id=run,
                ts=now + timedelta(seconds=3),
            ),
        ],
        events=[_run_completed(run, ts=now + timedelta(seconds=4))],
    )
    async with maker() as s:
        detail = await _svc(s).get_run_detail(run)

    assert detail is not None
    kinds = [t.kind for t in detail.turns]
    assert kinds == ["user_input", "tool_call", "message"]
    tool_turn = detail.turns[1]
    assert isinstance(tool_turn, TurnToolCall)
    assert tool_turn.name == "fetch_url"
    assert tool_turn.args == {"url": "https://example.com"}
    assert tool_turn.result == {"title": "hi"}
    assert tool_turn.ts_returned is not None


@pytest.mark.asyncio
async def test_tool_call_without_result_stays_unreturned(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    run = "run_tool_orphan"
    tc = ToolCall(
        id="tc-orphan",
        tool_id="noop",
        args={},
        status=ToolCallStatus.RUNNING,
    )
    await _seed(
        maker,
        messages=[
            _msg(role="user", content="go", run_id=run, ts=now),
            _msg(
                role="assistant",
                content="",
                run_id=run,
                ts=now + timedelta(seconds=1),
                tool_calls=[tc],
            ),
        ],
        events=[_run_started(run, ts=now)],
    )
    async with maker() as s:
        detail = await _svc(s).get_run_detail(run)

    assert detail is not None
    assert detail.status == RunStatus.RUNNING
    tool_turn = detail.turns[-1]
    assert isinstance(tool_turn, TurnToolCall)
    assert tool_turn.result is None
    assert tool_turn.ts_returned is None


@pytest.mark.asyncio
async def test_failed_run_surfaces_error_and_status(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    run = "run_broken"
    await _seed(
        maker,
        messages=[
            _msg(role="user", content="do", run_id=run, ts=now),
        ],
        events=[_run_failed(run, ts=now + timedelta(seconds=1), error="401 Unauthorized")],
    )
    async with maker() as s:
        detail = await _svc(s).get_run_detail(run)

    assert detail is not None
    assert detail.status == RunStatus.FAILED
    assert detail.error is not None
    assert detail.error.message == "401 Unauthorized"
    assert detail.error.kind == "tool_error"


@pytest.mark.asyncio
async def test_task_id_is_resolved_from_task_run_ids(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    run = "run_with_task"
    task = Task(
        id="task-1",
        title="weekly digest",
        goal="do it",
        dod="done",
        assignee_id="emp-lead",
        status=TaskStatus.COMPLETED,
        source=TaskSource.USER,
        created_by="test",
        run_ids=[run],
        artifact_ids=[],
        conversation_id="conv-1",
        created_at=now,
        updated_at=now,
    )
    await _seed(
        maker,
        messages=[
            _msg(role="user", content="run it", run_id=run, ts=now),
            _msg(
                role="assistant",
                content="done",
                run_id=run,
                ts=now + timedelta(seconds=1),
            ),
        ],
        events=[_run_completed(run, ts=now + timedelta(seconds=2))],
        tasks=[task],
    )
    async with maker() as s:
        detail = await _svc(s).get_run_detail(run)

    assert detail is not None
    assert detail.task_id == "task-1"


@pytest.mark.asyncio
async def test_system_messages_are_skipped(
    maker: async_sessionmaker[AsyncSession],
) -> None:
    now = datetime.now(UTC)
    run = "run_sys"
    await _seed(
        maker,
        messages=[
            _msg(role="system", content="[system] compact", run_id=run, ts=now),
            _msg(role="user", content="hi", run_id=run, ts=now + timedelta(seconds=1)),
            _msg(
                role="assistant",
                content="yo",
                run_id=run,
                ts=now + timedelta(seconds=2),
            ),
        ],
        events=[_run_completed(run, ts=now + timedelta(seconds=3))],
    )
    async with maker() as s:
        detail = await _svc(s).get_run_detail(run)

    assert detail is not None
    assert [t.kind for t in detail.turns] == ["user_input", "message"]
