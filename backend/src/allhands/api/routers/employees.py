"""Employee read endpoints for frontend bootstrapping."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from allhands.api.deps import get_employee_service, get_session
from allhands.core.errors import EmployeeNotFound

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/employees", tags=["employees"])


class EmployeeResponse(BaseModel):
    id: str
    name: str
    description: str
    is_lead_agent: bool
    tool_ids: list[str]
    skill_ids: list[str]
    max_iterations: int
    model_ref: str


@router.get("/lead", response_model=EmployeeResponse)
async def get_lead_employee(
    session: AsyncSession = Depends(get_session),
) -> EmployeeResponse:
    svc = await get_employee_service(session)
    lead = await svc.get_lead()
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead agent not found.")
    return EmployeeResponse(
        id=lead.id,
        name=lead.name,
        description=lead.description,
        is_lead_agent=lead.is_lead_agent,
        tool_ids=lead.tool_ids,
        skill_ids=lead.skill_ids,
        max_iterations=lead.max_iterations,
        model_ref=lead.model_ref,
    )


@router.get("", response_model=list[EmployeeResponse])
async def list_employees(
    session: AsyncSession = Depends(get_session),
) -> list[EmployeeResponse]:
    svc = await get_employee_service(session)
    employees = await svc.list_all()
    return [
        EmployeeResponse(
            id=e.id,
            name=e.name,
            description=e.description,
            is_lead_agent=e.is_lead_agent,
            tool_ids=e.tool_ids,
            skill_ids=e.skill_ids,
            max_iterations=e.max_iterations,
            model_ref=e.model_ref,
        )
        for e in employees
    ]


@router.get("/{employee_id}", response_model=EmployeeResponse)
async def get_employee(
    employee_id: str,
    session: AsyncSession = Depends(get_session),
) -> EmployeeResponse:
    svc = await get_employee_service(session)
    try:
        emp = await svc.get(employee_id)
    except EmployeeNotFound as exc:
        raise HTTPException(status_code=404, detail=f"Employee {employee_id!r} not found.") from exc
    return EmployeeResponse(
        id=emp.id,
        name=emp.name,
        description=emp.description,
        is_lead_agent=emp.is_lead_agent,
        tool_ids=emp.tool_ids,
        skill_ids=emp.skill_ids,
        max_iterations=emp.max_iterations,
        model_ref=emp.model_ref,
    )
