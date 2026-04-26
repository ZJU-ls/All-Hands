"""ADR 0019 C1 (Round 1) · update_plan / view_plan executors.

Tests the Claude-Code-style atomic-replace plan tool. Validation rules
mirror the executor's docstring contract:

  - 1-20 todos
  - non-empty content
  - status ∈ {pending, in_progress, completed}
  - at most 1 in_progress
  - atomic replace: subsequent calls keep the same plan_id and replace
    steps wholesale (within a conversation)
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from allhands.core.plan import StepStatus
from allhands.execution.tools.meta.plan_executors import (
    UPDATE_PLAN_TOOL_ID,
    VIEW_PLAN_TOOL_ID,
    make_update_plan_executor,
    make_view_plan_executor,
)
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlAgentPlanRepo


@pytest_asyncio.fixture
async def session() -> AsyncIterator[AsyncSession]:
    """In-memory SQLite session for plan repo tests."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s


# ── Tool ID constants ───────────────────────────────────────────────────


def test_tool_ids_are_namespaced() -> None:
    """Public tool ids stay stable under allhands.meta.* per L01."""
    assert UPDATE_PLAN_TOOL_ID == "allhands.meta.update_plan"
    assert VIEW_PLAN_TOOL_ID == "allhands.meta.view_plan"


# ── update_plan: happy path ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_first_update_creates_plan_with_correct_steps(
    session: AsyncSession,
) -> None:
    repo = SqlAgentPlanRepo(session)
    exec_fn = make_update_plan_executor(repo=repo, conversation_id="conv-1", employee_id="emp-1")

    out = await exec_fn(
        todos=[
            {"content": "Read code", "activeForm": "Reading code", "status": "in_progress"},
            {"content": "Write tests", "activeForm": "Writing tests", "status": "pending"},
            {"content": "Refactor", "activeForm": "Refactoring", "status": "pending"},
        ],
        title="Fix the bug",
    )

    assert "plan_id" in out
    assert out["summary"] == "0/3 done · 1 in progress · 2 pending"

    plan = await repo.get_latest_for_conversation("conv-1")
    assert plan is not None
    assert plan.title == "Fix the bug"
    assert len(plan.steps) == 3
    assert plan.steps[0].status == StepStatus.RUNNING
    assert plan.steps[0].title == "Read code"
    assert plan.steps[0].note == "Reading code"  # activeForm stashed in note
    assert plan.steps[1].status == StepStatus.PENDING


@pytest.mark.asyncio
async def test_subsequent_update_replaces_steps_keeps_plan_id(
    session: AsyncSession,
) -> None:
    """Atomic replace: same plan_id, steps wholesale-replaced."""
    repo = SqlAgentPlanRepo(session)
    exec_fn = make_update_plan_executor(repo=repo, conversation_id="conv-1", employee_id="emp-1")

    out1 = await exec_fn(
        todos=[
            {"content": "A", "activeForm": "Doing A", "status": "in_progress"},
            {"content": "B", "activeForm": "Doing B", "status": "pending"},
        ],
        title="First",
    )
    out2 = await exec_fn(
        todos=[
            {"content": "A", "activeForm": "Doing A", "status": "completed"},
            {"content": "B", "activeForm": "Doing B", "status": "in_progress"},
            {"content": "C", "activeForm": "Doing C", "status": "pending"},
        ],
        # Title intentionally omitted — should inherit "First".
    )

    assert out1["plan_id"] == out2["plan_id"], "plan_id must be stable across calls"

    plan = await repo.get_latest_for_conversation("conv-1")
    assert plan is not None
    assert plan.title == "First", "title preserved when not provided in 2nd call"
    assert len(plan.steps) == 3
    assert plan.steps[0].status == StepStatus.DONE
    assert plan.steps[1].status == StepStatus.RUNNING
    assert plan.steps[2].status == StepStatus.PENDING


@pytest.mark.asyncio
async def test_explicit_title_in_second_call_replaces(
    session: AsyncSession,
) -> None:
    repo = SqlAgentPlanRepo(session)
    exec_fn = make_update_plan_executor(repo=repo, conversation_id="conv-1", employee_id="emp-1")

    await exec_fn(
        todos=[{"content": "x", "activeForm": "x-ing", "status": "pending"}],
        title="Old",
    )
    await exec_fn(
        todos=[{"content": "x", "activeForm": "x-ing", "status": "in_progress"}],
        title="New",
    )

    plan = await repo.get_latest_for_conversation("conv-1")
    assert plan is not None
    assert plan.title == "New"


# ── update_plan: validation ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rejects_empty_todos(session: AsyncSession) -> None:
    exec_fn = make_update_plan_executor(
        repo=SqlAgentPlanRepo(session), conversation_id="c", employee_id="e"
    )
    out = await exec_fn(todos=[])
    assert "error" in out
    assert "non-empty" in out["error"]


@pytest.mark.asyncio
async def test_rejects_more_than_20_todos(session: AsyncSession) -> None:
    exec_fn = make_update_plan_executor(
        repo=SqlAgentPlanRepo(session), conversation_id="c", employee_id="e"
    )
    todos = [
        {"content": f"todo {i}", "activeForm": f"doing {i}", "status": "pending"} for i in range(21)
    ]
    out = await exec_fn(todos=todos)
    assert "error" in out
    assert "20" in out["error"]


@pytest.mark.asyncio
async def test_rejects_two_in_progress(session: AsyncSession) -> None:
    """Claude Code's hard rule: at most one in_progress at a time."""
    exec_fn = make_update_plan_executor(
        repo=SqlAgentPlanRepo(session), conversation_id="c", employee_id="e"
    )
    out = await exec_fn(
        todos=[
            {"content": "A", "activeForm": "doing A", "status": "in_progress"},
            {"content": "B", "activeForm": "doing B", "status": "in_progress"},
            {"content": "C", "activeForm": "doing C", "status": "pending"},
        ],
    )
    assert "error" in out
    assert "in_progress" in out["error"]


@pytest.mark.asyncio
async def test_rejects_invalid_status_string(session: AsyncSession) -> None:
    exec_fn = make_update_plan_executor(
        repo=SqlAgentPlanRepo(session), conversation_id="c", employee_id="e"
    )
    out = await exec_fn(
        todos=[
            {"content": "x", "activeForm": "x-ing", "status": "running"},
            # ↑ legacy enum from old tool group; the new tool only accepts
            # pending / in_progress / completed.
        ],
    )
    assert "error" in out


@pytest.mark.asyncio
async def test_rejects_empty_content(session: AsyncSession) -> None:
    exec_fn = make_update_plan_executor(
        repo=SqlAgentPlanRepo(session), conversation_id="c", employee_id="e"
    )
    out = await exec_fn(
        todos=[{"content": "  ", "activeForm": "x", "status": "pending"}],
    )
    assert "error" in out
    assert "content" in out["error"]


@pytest.mark.asyncio
async def test_falls_back_to_content_when_active_form_missing(
    session: AsyncSession,
) -> None:
    """Weak models forget activeForm — fall back to content rather than
    failing the call. Documented in the executor's comments."""
    exec_fn = make_update_plan_executor(
        repo=SqlAgentPlanRepo(session), conversation_id="c", employee_id="e"
    )
    out = await exec_fn(
        todos=[{"content": "Read code", "activeForm": "", "status": "pending"}],
    )
    assert "error" not in out


# ── update_plan: status mapping ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_status_mapping_pending_to_pending(session: AsyncSession) -> None:
    repo = SqlAgentPlanRepo(session)
    exec_fn = make_update_plan_executor(repo=repo, conversation_id="c", employee_id="e")
    await exec_fn(
        todos=[{"content": "x", "activeForm": "x-ing", "status": "pending"}],
    )
    plan = await repo.get_latest_for_conversation("c")
    assert plan is not None
    assert plan.steps[0].status == StepStatus.PENDING


@pytest.mark.asyncio
async def test_status_mapping_in_progress_to_running(session: AsyncSession) -> None:
    repo = SqlAgentPlanRepo(session)
    exec_fn = make_update_plan_executor(repo=repo, conversation_id="c", employee_id="e")
    await exec_fn(
        todos=[{"content": "x", "activeForm": "x-ing", "status": "in_progress"}],
    )
    plan = await repo.get_latest_for_conversation("c")
    assert plan is not None
    assert plan.steps[0].status == StepStatus.RUNNING


@pytest.mark.asyncio
async def test_status_mapping_completed_to_done(session: AsyncSession) -> None:
    repo = SqlAgentPlanRepo(session)
    exec_fn = make_update_plan_executor(repo=repo, conversation_id="c", employee_id="e")
    await exec_fn(
        todos=[{"content": "x", "activeForm": "x-ing", "status": "completed"}],
    )
    plan = await repo.get_latest_for_conversation("c")
    assert plan is not None
    assert plan.steps[0].status == StepStatus.DONE


# ── view_plan ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_view_plan_returns_error_when_no_plan(session: AsyncSession) -> None:
    repo = SqlAgentPlanRepo(session)
    exec_fn = make_view_plan_executor(repo=repo, conversation_id="empty-conv")
    out = await exec_fn()
    assert "error" in out


@pytest.mark.asyncio
async def test_view_plan_round_trips_after_update(session: AsyncSession) -> None:
    """Round-trip: update_plan then view_plan returns the same shape the
    agent sent (plus a plan_id)."""
    repo = SqlAgentPlanRepo(session)
    update = make_update_plan_executor(repo=repo, conversation_id="c", employee_id="e")
    view = make_view_plan_executor(repo=repo, conversation_id="c")

    await update(
        todos=[
            {"content": "Read", "activeForm": "Reading", "status": "completed"},
            {"content": "Write", "activeForm": "Writing", "status": "in_progress"},
            {"content": "Test", "activeForm": "Testing", "status": "pending"},
        ],
        title="Demo",
    )

    out = await view()
    assert out["title"] == "Demo"
    assert "plan_id" in out
    todos = out["todos"]
    assert len(todos) == 3
    assert todos[0] == {
        "content": "Read",
        "activeForm": "Reading",
        "status": "completed",
    }
    assert todos[1]["status"] == "in_progress"
    assert todos[2]["status"] == "pending"


# ── conversation isolation ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_two_conversations_have_independent_plans(
    session: AsyncSession,
) -> None:
    """Each conversation_id gets its own plan thread."""
    repo = SqlAgentPlanRepo(session)
    a = make_update_plan_executor(repo=repo, conversation_id="A", employee_id="e")
    b = make_update_plan_executor(repo=repo, conversation_id="B", employee_id="e")

    a_out = await a(
        todos=[{"content": "alpha", "activeForm": "alpha-ing", "status": "pending"}],
        title="Plan A",
    )
    b_out = await b(
        todos=[{"content": "beta", "activeForm": "beta-ing", "status": "pending"}],
        title="Plan B",
    )

    assert a_out["plan_id"] != b_out["plan_id"]

    plan_a = await repo.get_latest_for_conversation("A")
    plan_b = await repo.get_latest_for_conversation("B")
    assert plan_a is not None and plan_b is not None
    assert plan_a.title == "Plan A"
    assert plan_b.title == "Plan B"


# ── derived title fallback ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_first_call_without_title_derives_from_first_todo(
    session: AsyncSession,
) -> None:
    """No title → derive a short fallback from first todo so the UI header
    isn't empty."""
    repo = SqlAgentPlanRepo(session)
    exec_fn = make_update_plan_executor(repo=repo, conversation_id="c", employee_id="e")
    await exec_fn(
        todos=[
            {
                "content": "Investigate the bug",
                "activeForm": "Investigating the bug",
                "status": "in_progress",
            }
        ],
    )
    plan = await repo.get_latest_for_conversation("c")
    assert plan is not None
    assert "Investigate the bug" in plan.title


# Misc: confirm the plan keeps an updated_at advance.
@pytest.mark.asyncio
async def test_updated_at_advances_on_replace(session: AsyncSession) -> None:
    repo = SqlAgentPlanRepo(session)
    exec_fn = make_update_plan_executor(repo=repo, conversation_id="c", employee_id="e")
    await exec_fn(
        todos=[{"content": "x", "activeForm": "x-ing", "status": "pending"}],
    )
    p1 = await repo.get_latest_for_conversation("c")
    assert p1 is not None
    t1 = p1.updated_at

    await asyncio.sleep(0.01)
    await exec_fn(
        todos=[{"content": "x", "activeForm": "x-ing", "status": "in_progress"}],
    )
    p2 = await repo.get_latest_for_conversation("c")
    assert p2 is not None
    assert p2.updated_at > t1
    assert p2.created_at == p1.created_at  # created_at preserved
    assert isinstance(p2.updated_at, datetime)
    assert p2.updated_at.tzinfo == UTC
