"""ADR 0019 C1 · Plan tool executors · the agent's working memo.

Phase C1 fills in the executor side of the plan_create / plan_update_step /
plan_complete_step / plan_view tools that have been declared in
``plan_tools.py`` since the v0 spec but only had no-op stubs in the
registry.

Plans are agent-internal: scope=WRITE but ``requires_confirmation=False``
because they don't touch external systems. They're persisted via
:class:`AgentPlanRepo` so progress survives uvicorn reloads, and
plan_view returns a Render envelope (``{component: "PlanTimeline", ...}``)
which the existing PlanTimeline frontend component picks up via the
component registry.

Per ADR 0019: no plan mode, no permission gating, no enter/exit ritual —
plan is a tool, agent CRUDs freely, user sees the timeline render in
chat. Permission management deferred to a later review per user feedback.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from allhands.core.plan import AgentPlan, PlanStep, StepStatus

if TYPE_CHECKING:
    from allhands.execution.registry import ToolExecutor
    from allhands.persistence.repositories import AgentPlanRepo


PLAN_CREATE_TOOL_ID = "allhands.meta.plan_create"
PLAN_UPDATE_STEP_TOOL_ID = "allhands.meta.plan_update_step"
PLAN_COMPLETE_STEP_TOOL_ID = "allhands.meta.plan_complete_step"
PLAN_VIEW_TOOL_ID = "allhands.meta.plan_view"


def _now() -> datetime:
    return datetime.now(UTC)


def _render_envelope(plan: AgentPlan) -> dict[str, Any]:
    """Project an AgentPlan into the PlanTimeline render envelope.

    The envelope shape ({component, props, interactions}) is duck-typed
    by ``_as_render_envelope`` in tool_pipeline / runner; emitting it
    triggers a RenderEvent which the frontend component registry
    dispatches into ``components/render/PlanTimeline.tsx``.
    """
    return {
        "component": "PlanTimeline",
        "props": {
            "title": plan.title,
            "steps": [
                {
                    "title": s.title,
                    "status": s.status.value,
                    "note": s.note,
                }
                for s in plan.steps
            ],
        },
        "interactions": [],
    }


def make_plan_create_executor(
    *,
    repo: AgentPlanRepo,
    conversation_id: str,
    employee_id: str,
) -> ToolExecutor:
    """Build the plan_create executor.

    Creates a fresh AgentPlan with PENDING steps, persists, returns
    plan_id + step_count so the agent can update steps later.
    """

    async def _exec(*, title: str, steps: list[str]) -> dict[str, Any]:
        if not title.strip():
            return {"error": "title must not be empty"}
        if not steps:
            return {"error": "steps must contain at least one item"}
        if len(steps) > 20:
            return {"error": "plan supports up to 20 steps"}
        plan_id = str(uuid.uuid4())
        now = _now()
        plan = AgentPlan(
            id=plan_id,
            conversation_id=conversation_id,
            run_id=None,
            owner_employee_id=employee_id,
            title=title.strip(),
            steps=[
                PlanStep(index=i, title=s.strip(), status=StepStatus.PENDING)
                for i, s in enumerate(steps)
                if s.strip()
            ],
            created_at=now,
            updated_at=now,
        )
        await repo.upsert(plan)
        return {"plan_id": plan_id, "step_count": len(plan.steps)}

    return _exec


def make_plan_update_step_executor(
    *,
    repo: AgentPlanRepo,
    conversation_id: str,
) -> ToolExecutor:
    """Build the plan_update_step executor.

    Mutates a single PlanStep's status (and optional note). AgentPlan +
    PlanStep are frozen Pydantic models, so we rebuild the plan with a
    new step list. ``conversation_id`` is used as a defense-in-depth
    check that callers can't cross-update plans from other conversations.
    """

    async def _exec(
        *,
        plan_id: str,
        step_index: int,
        status: str,
        note: str | None = None,
    ) -> dict[str, Any]:
        try:
            new_status = StepStatus(status)
        except ValueError:
            return {
                "error": f"unknown status {status!r}; expected one of "
                f"{[s.value for s in StepStatus]}",
            }
        plan = await repo.get(plan_id)
        if plan is None:
            return {"error": f"plan {plan_id!r} not found"}
        if plan.conversation_id != conversation_id:
            return {"error": "plan does not belong to this conversation"}
        if step_index < 0 or step_index >= len(plan.steps):
            return {
                "error": f"step_index {step_index} out of range [0..{len(plan.steps) - 1}]",
            }
        new_steps = [
            (
                PlanStep(
                    index=s.index,
                    title=s.title,
                    status=new_status,
                    note=note if note is not None else s.note,
                )
                if i == step_index
                else s
            )
            for i, s in enumerate(plan.steps)
        ]
        updated = plan.model_copy(
            update={"steps": new_steps, "updated_at": _now()},
        )
        await repo.upsert(updated)
        return {
            "plan_id": plan_id,
            "step_index": step_index,
            "status": new_status.value,
        }

    return _exec


def make_plan_complete_step_executor(
    *,
    repo: AgentPlanRepo,
    conversation_id: str,
) -> ToolExecutor:
    """plan_complete_step is plan_update_step with status='done' baked in.
    Convenience for the common case so the agent doesn't have to remember
    the enum string.
    """
    update = make_plan_update_step_executor(repo=repo, conversation_id=conversation_id)

    async def _exec(*, plan_id: str, step_index: int) -> dict[str, Any]:
        result: dict[str, Any] = await update(plan_id=plan_id, step_index=step_index, status="done")
        return result

    return _exec


def make_plan_view_executor(
    *,
    repo: AgentPlanRepo,
    conversation_id: str,
) -> ToolExecutor:
    """plan_view returns a Render envelope so the chat renders a
    PlanTimeline inline. With no plan_id, fetches the latest plan for
    the current conversation. Returns a simple error envelope when no
    plan exists yet — agent will typically call plan_create before
    plan_view, but a guard against off-script flows.
    """

    async def _exec(*, plan_id: str | None = None) -> dict[str, Any]:
        plan: AgentPlan | None
        if plan_id:
            plan = await repo.get(plan_id)
            if plan is None:
                return {"error": f"plan {plan_id!r} not found"}
            if plan.conversation_id != conversation_id:
                return {"error": "plan does not belong to this conversation"}
        else:
            plan = await repo.get_latest_for_conversation(conversation_id)
            if plan is None:
                return {
                    "error": "no plan exists for this conversation yet — call plan_create first"
                }
        return _render_envelope(plan)

    return _exec


__all__ = [
    "PLAN_COMPLETE_STEP_TOOL_ID",
    "PLAN_CREATE_TOOL_ID",
    "PLAN_UPDATE_STEP_TOOL_ID",
    "PLAN_VIEW_TOOL_ID",
    "make_plan_complete_step_executor",
    "make_plan_create_executor",
    "make_plan_update_step_executor",
    "make_plan_view_executor",
]
