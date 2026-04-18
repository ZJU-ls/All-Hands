"""PlanService — create / mutate / view AgentPlan records.

See `docs/specs/agent-design/2026-04-18-agent-design.md` § 5.

The Plan is the agent's working memo. Side-effect-free for confirmation
purposes — mutations go through without a Gate prompt so the UX stays fluid.
Real side effects happen in the business tools the agent runs between steps.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from allhands.core import AgentPlan, PlanStep, StepStatus
from allhands.core.errors import DomainError

if TYPE_CHECKING:
    from allhands.persistence.repositories import AgentPlanRepo


MIN_STEPS = 1
MAX_STEPS = 20


class PlanError(DomainError):
    """Plan validation / lookup failure."""


class PlanNotFound(PlanError):
    pass


class PlanService:
    def __init__(self, repo: AgentPlanRepo) -> None:
        self._repo = repo

    async def create(
        self,
        conversation_id: str,
        owner_employee_id: str,
        title: str,
        step_titles: list[str],
        run_id: str | None = None,
    ) -> AgentPlan:
        if not (MIN_STEPS <= len(step_titles) <= MAX_STEPS):
            raise PlanError(
                f"Plan must have between {MIN_STEPS} and {MAX_STEPS} steps, got {len(step_titles)}."
            )
        now = datetime.now(UTC)
        plan = AgentPlan(
            id=str(uuid.uuid4()),
            conversation_id=conversation_id,
            run_id=run_id,
            owner_employee_id=owner_employee_id,
            title=title,
            steps=[PlanStep(index=i, title=t) for i, t in enumerate(step_titles)],
            created_at=now,
            updated_at=now,
        )
        return await self._repo.upsert(plan)

    async def get(self, plan_id: str) -> AgentPlan:
        plan = await self._repo.get(plan_id)
        if plan is None:
            raise PlanNotFound(f"Plan {plan_id!r} not found.")
        return plan

    async def get_latest_for_conversation(self, conversation_id: str) -> AgentPlan | None:
        return await self._repo.get_latest_for_conversation(conversation_id)

    async def list_for_conversation(self, conversation_id: str) -> list[AgentPlan]:
        return await self._repo.list_for_conversation(conversation_id)

    async def update_step(
        self,
        plan_id: str,
        step_index: int,
        status: StepStatus,
        note: str | None = None,
    ) -> AgentPlan:
        plan = await self.get(plan_id)
        if not (0 <= step_index < len(plan.steps)):
            raise PlanError(f"Step index {step_index} out of range 0..{len(plan.steps) - 1}.")
        new_steps = list(plan.steps)
        old = new_steps[step_index]
        new_steps[step_index] = PlanStep(
            index=old.index,
            title=old.title,
            status=status,
            note=note if note is not None else old.note,
        )
        updated = plan.model_copy(update={"steps": new_steps, "updated_at": datetime.now(UTC)})
        return await self._repo.upsert(updated)

    async def complete_step(self, plan_id: str, step_index: int) -> AgentPlan:
        return await self.update_step(plan_id, step_index, StepStatus.DONE)
