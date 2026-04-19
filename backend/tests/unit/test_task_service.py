"""TaskService unit tests — spec § 4 / § 6 semantics.

Covers: create (with DoD invariant), list filters, state transitions (legal +
illegal), terminal invariants (result_summary on completed / error_summary on
failed), event emission shape.
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from allhands.core import TaskSource, TaskStatus
from allhands.core.trigger import EventEnvelope
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlTaskRepo
from allhands.services.task_service import (
    TaskError,
    TaskNotFound,
    TaskService,
    TaskTransitionError,
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


def _svc(session: AsyncSession, emitted: list[EventEnvelope] | None = None) -> TaskService:
    if emitted is not None:

        def capture(ev: EventEnvelope) -> None:
            emitted.append(ev)

        return TaskService(SqlTaskRepo(session), event_emitter=capture)
    return TaskService(SqlTaskRepo(session))


async def _create_default(svc: TaskService) -> str:
    task = await svc.create(
        title="Draft release note",
        goal="Compile notable PRs from last sprint into a customer-facing note.",
        dod="- format: markdown\n- must include: hero feature\n- must not: unshipped PRs",
        assignee_id="emp-writer",
        source=TaskSource.USER,
        created_by="user",
    )
    return task.id


class TestCreate:
    async def test_create_emits_task_created_event(self, session: AsyncSession) -> None:
        events: list[EventEnvelope] = []
        svc = _svc(session, emitted=events)
        await _create_default(svc)
        assert [e.kind for e in events] == ["task.created"]
        assert events[0].link is not None
        assert events[0].link.startswith("/tasks/")
        assert events[0].severity == "info"

    async def test_create_rejects_missing_dod(self, session: AsyncSession) -> None:
        svc = _svc(session)
        with pytest.raises(TaskError, match="dod"):
            await svc.create(
                title="t",
                goal="g",
                dod="   ",
                assignee_id="emp-1",
                source=TaskSource.USER,
                created_by="user",
            )

    async def test_create_rejects_blank_title(self, session: AsyncSession) -> None:
        svc = _svc(session)
        with pytest.raises(TaskError, match="title"):
            await svc.create(
                title="",
                goal="g",
                dod="d",
                assignee_id="emp-1",
                source=TaskSource.USER,
                created_by="user",
            )

    async def test_created_task_is_queued(self, session: AsyncSession) -> None:
        svc = _svc(session)
        task_id = await _create_default(svc)
        task = await svc.get(task_id)
        assert task.status == TaskStatus.QUEUED
        assert task.completed_at is None


class TestTransitions:
    async def test_start_moves_queued_to_running_and_records_run_id(
        self, session: AsyncSession
    ) -> None:
        events: list[EventEnvelope] = []
        svc = _svc(session, emitted=events)
        task_id = await _create_default(svc)
        task = await svc.start(task_id, run_id="run-1")
        assert task.status == TaskStatus.RUNNING
        assert "run-1" in task.run_ids
        kinds = [e.kind for e in events]
        assert "task.started" in kinds

    async def test_complete_requires_result_summary(self, session: AsyncSession) -> None:
        svc = _svc(session)
        task_id = await _create_default(svc)
        await svc.start(task_id, run_id="run-1")
        with pytest.raises(TaskError, match="result_summary"):
            await svc.complete(task_id, result_summary="  ")

    async def test_complete_fills_result_summary_and_terminal_stamp(
        self, session: AsyncSession
    ) -> None:
        svc = _svc(session)
        task_id = await _create_default(svc)
        await svc.start(task_id, run_id="run-1")
        task = await svc.complete(
            task_id,
            result_summary="Shipped. See attached.",
            artifact_ids=["a-1", "a-2"],
            tokens_used=1234,
        )
        assert task.status == TaskStatus.COMPLETED
        assert task.result_summary == "Shipped. See attached."
        assert task.artifact_ids == ["a-1", "a-2"]
        assert task.completed_at is not None
        assert task.tokens_used == 1234

    async def test_request_input_blocks_until_answered(self, session: AsyncSession) -> None:
        events: list[EventEnvelope] = []
        svc = _svc(session, emitted=events)
        task_id = await _create_default(svc)
        await svc.start(task_id, run_id="r")
        paused = await svc.request_input(task_id, "What tone?")
        assert paused.status == TaskStatus.NEEDS_INPUT
        assert paused.pending_input_question == "What tone?"
        assert any(e.kind == "task.needs_input" and e.severity == "warn" for e in events)
        # Answer clears the question and resumes
        resumed = await svc.answer_input(task_id, "Professional, not stuffy.")
        assert resumed.status == TaskStatus.RUNNING
        assert resumed.pending_input_question is None

    async def test_answer_input_rejects_when_not_in_needs_input(
        self, session: AsyncSession
    ) -> None:
        svc = _svc(session)
        task_id = await _create_default(svc)
        await svc.start(task_id, run_id="r")
        with pytest.raises(TaskTransitionError, match="expected needs_input"):
            await svc.answer_input(task_id, "irrelevant")

    async def test_approve_denied_transitions_to_failed(self, session: AsyncSession) -> None:
        svc = _svc(session)
        task_id = await _create_default(svc)
        await svc.start(task_id, run_id="r")
        await svc.request_approval(task_id, {"tool_id": "x", "summary": "risky"})
        task = await svc.approve(task_id, decision="denied", note="too risky")
        assert task.status == TaskStatus.FAILED
        assert task.error_summary is not None
        assert "denied" in task.error_summary

    async def test_cancel_blocks_terminal_states(self, session: AsyncSession) -> None:
        svc = _svc(session)
        task_id = await _create_default(svc)
        await svc.start(task_id, run_id="r")
        await svc.complete(task_id, result_summary="done")
        with pytest.raises(TaskTransitionError, match="terminal"):
            await svc.cancel(task_id)

    async def test_illegal_transition_rejected(self, session: AsyncSession) -> None:
        svc = _svc(session)
        task_id = await _create_default(svc)
        # QUEUED -> COMPLETED is illegal (must go through RUNNING first)
        with pytest.raises(TaskTransitionError):
            await svc.complete(task_id, result_summary="never ran")


class TestListing:
    async def test_count_active_includes_all_non_terminal(self, session: AsyncSession) -> None:
        svc = _svc(session)
        _ = await _create_default(svc)  # queued
        t2 = await _create_default(svc)
        t3 = await _create_default(svc)
        await svc.start(t2, run_id="r")
        await svc.start(t3, run_id="r")
        await svc.complete(t3, result_summary="done")
        assert await svc.count_active() == 2  # t1 queued + t2 running

    async def test_list_filter_by_status(self, session: AsyncSession) -> None:
        svc = _svc(session)
        t1 = await _create_default(svc)
        _t2 = await _create_default(svc)
        await svc.start(t1, run_id="r")
        running = await svc.list_all(statuses=[TaskStatus.RUNNING])
        assert len(running) == 1
        assert running[0].id == t1

    async def test_get_missing_raises(self, session: AsyncSession) -> None:
        svc = _svc(session)
        with pytest.raises(TaskNotFound):
            await svc.get("T-does-not-exist")


class TestEventEmissionRobustness:
    async def test_failing_emitter_does_not_rollback_state(self, session: AsyncSession) -> None:
        def boom(ev: EventEnvelope) -> None:
            raise RuntimeError("sentry error")

        svc = TaskService(SqlTaskRepo(session), event_emitter=boom)
        task = await svc.create(
            title="t",
            goal="g",
            dod="d",
            assignee_id="emp-1",
            source=TaskSource.USER,
            created_by="user",
        )
        # Persistence survived despite emitter blowing up
        reread = await svc.get(task.id)
        assert reread.id == task.id
        assert reread.status == TaskStatus.QUEUED
