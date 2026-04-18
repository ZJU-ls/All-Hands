"""AgentPlan read endpoints + meta-tool-backed write endpoints.

Mirror of the Plan Meta Tools (see `execution/tools/meta/plan_tools.py`) —
same service, two entry points (L01). UI calls REST to scrub the latest plan
for a conversation; Lead Agent calls the identical logic via Meta Tool.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import (
    AsyncSession,  # noqa: TC002 — runtime-needed for FastAPI Depends resolution
)

from allhands.api.deps import get_session
from allhands.core import AgentPlan, StepStatus
from allhands.persistence.sql_repos import SqlAgentPlanRepo
from allhands.services.plan_service import PlanError, PlanNotFound, PlanService

router = APIRouter(prefix="/plans", tags=["plans"])


class PlanStepResponse(BaseModel):
    index: int
    title: str
    status: str
    note: str | None = None


class PlanResponse(BaseModel):
    id: str
    conversation_id: str
    run_id: str | None = None
    owner_employee_id: str
    title: str
    steps: list[PlanStepResponse]
    created_at: str
    updated_at: str


class PlanCreateRequest(BaseModel):
    conversation_id: str
    owner_employee_id: str
    title: str = Field(min_length=1, max_length=512)
    steps: list[str] = Field(min_length=1, max_length=20)
    run_id: str | None = None


class PlanUpdateStepRequest(BaseModel):
    step_index: int = Field(ge=0)
    status: StepStatus
    note: str | None = None


def _to_response(plan: AgentPlan) -> PlanResponse:
    return PlanResponse(
        id=plan.id,
        conversation_id=plan.conversation_id,
        run_id=plan.run_id,
        owner_employee_id=plan.owner_employee_id,
        title=plan.title,
        steps=[
            PlanStepResponse(index=s.index, title=s.title, status=s.status.value, note=s.note)
            for s in plan.steps
        ],
        created_at=plan.created_at.isoformat(),
        updated_at=plan.updated_at.isoformat(),
    )


def _service(session: AsyncSession) -> PlanService:
    return PlanService(SqlAgentPlanRepo(session))


@router.get("/conversation/{conversation_id}/latest", response_model=PlanResponse | None)
async def get_latest_plan_for_conversation(
    conversation_id: str,
    session: AsyncSession = Depends(get_session),
) -> PlanResponse | None:
    plan = await _service(session).get_latest_for_conversation(conversation_id)
    return _to_response(plan) if plan else None


@router.get("/conversation/{conversation_id}", response_model=list[PlanResponse])
async def list_plans_for_conversation(
    conversation_id: str,
    session: AsyncSession = Depends(get_session),
) -> list[PlanResponse]:
    plans = await _service(session).list_for_conversation(conversation_id)
    return [_to_response(p) for p in plans]


@router.get("/{plan_id}", response_model=PlanResponse)
async def get_plan(
    plan_id: str,
    session: AsyncSession = Depends(get_session),
) -> PlanResponse:
    try:
        plan = await _service(session).get(plan_id)
    except PlanNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_response(plan)


@router.post("", response_model=PlanResponse, status_code=201)
async def create_plan(
    body: PlanCreateRequest,
    session: AsyncSession = Depends(get_session),
) -> PlanResponse:
    try:
        plan = await _service(session).create(
            conversation_id=body.conversation_id,
            owner_employee_id=body.owner_employee_id,
            title=body.title,
            step_titles=body.steps,
            run_id=body.run_id,
        )
    except PlanError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_response(plan)


@router.patch("/{plan_id}/step", response_model=PlanResponse)
async def update_plan_step(
    plan_id: str,
    body: PlanUpdateStepRequest,
    session: AsyncSession = Depends(get_session),
) -> PlanResponse:
    try:
        plan = await _service(session).update_step(plan_id, body.step_index, body.status, body.note)
    except PlanNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PlanError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_response(plan)
