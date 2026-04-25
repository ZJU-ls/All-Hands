"""ADR 0019 C1 · Plan executor unit tests."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest

from allhands.core.plan import AgentPlan, PlanStep, StepStatus
from allhands.execution.tools.meta.plan_executors import (
    make_plan_complete_step_executor,
    make_plan_create_executor,
    make_plan_update_step_executor,
    make_plan_view_executor,
)


class _FakeAgentPlanRepo:
    """In-memory AgentPlanRepo for unit tests · matches Protocol shape."""

    def __init__(self) -> None:
        self._plans: dict[str, AgentPlan] = {}

    async def get(self, plan_id: str) -> AgentPlan | None:
        return self._plans.get(plan_id)

    async def get_latest_for_conversation(self, conversation_id: str) -> AgentPlan | None:
        candidates = [p for p in self._plans.values() if p.conversation_id == conversation_id]
        if not candidates:
            return None
        return sorted(candidates, key=lambda p: p.created_at)[-1]

    async def list_for_conversation(self, conversation_id: str) -> list[AgentPlan]:
        return [p for p in self._plans.values() if p.conversation_id == conversation_id]

    async def upsert(self, plan: AgentPlan) -> AgentPlan:
        self._plans[plan.id] = plan
        return plan

    async def delete(self, plan_id: str) -> None:
        self._plans.pop(plan_id, None)


CONV = "conv_abc"
EMP = "emp_test"


# --- create ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_plan_create_persists_and_returns_id() -> None:
    repo = _FakeAgentPlanRepo()
    create = make_plan_create_executor(repo=repo, conversation_id=CONV, employee_id=EMP)
    out = await create(title="重构 X", steps=["读代码", "拆模块", "写测试"])
    assert "plan_id" in out
    assert out["step_count"] == 3
    saved = await repo.get(out["plan_id"])
    assert saved is not None
    assert saved.title == "重构 X"
    assert saved.conversation_id == CONV
    assert saved.owner_employee_id == EMP
    assert [s.title for s in saved.steps] == ["读代码", "拆模块", "写测试"]
    assert all(s.status == StepStatus.PENDING for s in saved.steps)


@pytest.mark.asyncio
async def test_plan_create_strips_whitespace_and_drops_empties() -> None:
    repo = _FakeAgentPlanRepo()
    create = make_plan_create_executor(repo=repo, conversation_id=CONV, employee_id=EMP)
    out = await create(title="  X  ", steps=["a", "  ", "b", "", "c"])
    plan = await repo.get(out["plan_id"])
    assert plan is not None
    assert plan.title == "X"
    assert [s.title for s in plan.steps] == ["a", "b", "c"]


@pytest.mark.asyncio
async def test_plan_create_rejects_empty_title() -> None:
    repo = _FakeAgentPlanRepo()
    create = make_plan_create_executor(repo=repo, conversation_id=CONV, employee_id=EMP)
    out = await create(title="   ", steps=["a"])
    assert "error" in out


@pytest.mark.asyncio
async def test_plan_create_rejects_no_steps() -> None:
    repo = _FakeAgentPlanRepo()
    create = make_plan_create_executor(repo=repo, conversation_id=CONV, employee_id=EMP)
    out = await create(title="t", steps=[])
    assert "error" in out


@pytest.mark.asyncio
async def test_plan_create_rejects_too_many_steps() -> None:
    repo = _FakeAgentPlanRepo()
    create = make_plan_create_executor(repo=repo, conversation_id=CONV, employee_id=EMP)
    out = await create(title="t", steps=[f"step {i}" for i in range(21)])
    assert "error" in out
    assert "20" in out["error"]


# --- update_step ----------------------------------------------------------


def _seed_plan(repo: _FakeAgentPlanRepo, conversation_id: str = CONV) -> str:
    plan_id = str(uuid.uuid4())
    plan = AgentPlan(
        id=plan_id,
        conversation_id=conversation_id,
        run_id=None,
        owner_employee_id=EMP,
        title="t",
        steps=[
            PlanStep(index=0, title="a"),
            PlanStep(index=1, title="b"),
            PlanStep(index=2, title="c"),
        ],
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    repo._plans[plan_id] = plan
    return plan_id


@pytest.mark.asyncio
async def test_plan_update_step_changes_status() -> None:
    repo = _FakeAgentPlanRepo()
    plan_id = _seed_plan(repo)
    upd = make_plan_update_step_executor(repo=repo, conversation_id=CONV)
    out = await upd(plan_id=plan_id, step_index=1, status="running")
    assert out["status"] == "running"
    plan = await repo.get(plan_id)
    assert plan is not None
    assert plan.steps[0].status == StepStatus.PENDING
    assert plan.steps[1].status == StepStatus.RUNNING
    assert plan.steps[2].status == StepStatus.PENDING


@pytest.mark.asyncio
async def test_plan_update_step_attaches_note() -> None:
    repo = _FakeAgentPlanRepo()
    plan_id = _seed_plan(repo)
    upd = make_plan_update_step_executor(repo=repo, conversation_id=CONV)
    await upd(plan_id=plan_id, step_index=0, status="failed", note="API 502")
    plan = await repo.get(plan_id)
    assert plan is not None
    assert plan.steps[0].status == StepStatus.FAILED
    assert plan.steps[0].note == "API 502"


@pytest.mark.asyncio
async def test_plan_update_step_unknown_status_returns_error() -> None:
    repo = _FakeAgentPlanRepo()
    plan_id = _seed_plan(repo)
    upd = make_plan_update_step_executor(repo=repo, conversation_id=CONV)
    out = await upd(plan_id=plan_id, step_index=0, status="unknown")
    assert "error" in out


@pytest.mark.asyncio
async def test_plan_update_step_unknown_plan_returns_error() -> None:
    repo = _FakeAgentPlanRepo()
    upd = make_plan_update_step_executor(repo=repo, conversation_id=CONV)
    out = await upd(plan_id="ghost", step_index=0, status="done")
    assert "error" in out


@pytest.mark.asyncio
async def test_plan_update_step_cross_conversation_blocked() -> None:
    """Defense-in-depth: even if the LLM in conversation A guessed a
    plan_id from conversation B, the executor refuses."""
    repo = _FakeAgentPlanRepo()
    plan_id = _seed_plan(repo, conversation_id="OTHER")
    upd = make_plan_update_step_executor(repo=repo, conversation_id=CONV)
    out = await upd(plan_id=plan_id, step_index=0, status="done")
    assert "error" in out
    assert "conversation" in out["error"]


@pytest.mark.asyncio
async def test_plan_update_step_index_out_of_range() -> None:
    repo = _FakeAgentPlanRepo()
    plan_id = _seed_plan(repo)
    upd = make_plan_update_step_executor(repo=repo, conversation_id=CONV)
    out = await upd(plan_id=plan_id, step_index=99, status="done")
    assert "error" in out


# --- complete_step --------------------------------------------------------


@pytest.mark.asyncio
async def test_plan_complete_step_shortcut() -> None:
    repo = _FakeAgentPlanRepo()
    plan_id = _seed_plan(repo)
    cmp = make_plan_complete_step_executor(repo=repo, conversation_id=CONV)
    out = await cmp(plan_id=plan_id, step_index=2)
    assert out["status"] == "done"
    plan = await repo.get(plan_id)
    assert plan is not None
    assert plan.steps[2].status == StepStatus.DONE


# --- view -----------------------------------------------------------------


@pytest.mark.asyncio
async def test_plan_view_with_id_returns_render_envelope() -> None:
    repo = _FakeAgentPlanRepo()
    plan_id = _seed_plan(repo)
    view = make_plan_view_executor(repo=repo, conversation_id=CONV)
    out = await view(plan_id=plan_id)
    assert out["component"] == "PlanTimeline"
    assert out["props"]["title"] == "t"
    assert len(out["props"]["steps"]) == 3
    assert all("status" in s for s in out["props"]["steps"])
    assert out["interactions"] == []


@pytest.mark.asyncio
async def test_plan_view_without_id_returns_latest_for_conversation() -> None:
    repo = _FakeAgentPlanRepo()
    create = make_plan_create_executor(repo=repo, conversation_id=CONV, employee_id=EMP)
    await create(title="老 plan", steps=["x"])
    out_new = await create(title="新 plan", steps=["y", "z"])
    view = make_plan_view_executor(repo=repo, conversation_id=CONV)
    out: dict[str, Any] = await view()
    assert out["component"] == "PlanTimeline"
    assert out["props"]["title"] == "新 plan"
    assert out["props"]["steps"][0]["title"] == "y"
    assert out_new["plan_id"]  # silence unused-var


@pytest.mark.asyncio
async def test_plan_view_no_plans_returns_error() -> None:
    repo = _FakeAgentPlanRepo()
    view = make_plan_view_executor(repo=repo, conversation_id=CONV)
    out = await view()
    assert "error" in out


@pytest.mark.asyncio
async def test_plan_view_cross_conversation_blocked() -> None:
    repo = _FakeAgentPlanRepo()
    plan_id = _seed_plan(repo, conversation_id="OTHER")
    view = make_plan_view_executor(repo=repo, conversation_id=CONV)
    out = await view(plan_id=plan_id)
    assert "error" in out
