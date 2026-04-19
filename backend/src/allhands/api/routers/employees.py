"""Employee REST endpoints — sibling of `/employees` UI page.

L01 扩展(CLAUDE.md §3.1 · 2026-04-18):Employee 是 agent-managed 资源,
**允许** REST CRUD 给 UI 独立操作用,**同时**必须在
`execution/tools/meta/employee_tools.py` 里有同名语义的 Meta Tool(由
``TestL01ToolFirstBoundary`` smoke-check 把关)。

**红线(§3.2):** request/response 不得出现 `mode` 字段;employee 的"运转
方式"在 UI 是 preset 概念,落库时由 `tool_ids / skill_ids / max_iterations`
三列表示。``EmployeeCreateRequest`` 用 ``extra="forbid"`` 主动拒绝偷运。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from allhands.api.deps import get_employee_service, get_session
from allhands.core.errors import EmployeeNotFound

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/employees", tags=["employees"])


class EmployeeResponse(BaseModel):
    id: str
    name: str
    description: str
    system_prompt: str
    is_lead_agent: bool
    tool_ids: list[str]
    skill_ids: list[str]
    max_iterations: int
    model_ref: str


class EmployeeCreateRequest(BaseModel):
    # Forbid unknown fields so a rogue `mode` key fails fast at 422 (§3.2).
    model_config = ConfigDict(extra="forbid")

    name: str
    description: str = ""
    system_prompt: str = ""
    model_ref: str = "openai/gpt-4o-mini"
    tool_ids: list[str] = Field(default_factory=list)
    skill_ids: list[str] = Field(default_factory=list)
    max_iterations: int = Field(default=10, ge=1, le=100)


class EmployeeUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str | None = None
    system_prompt: str | None = None
    model_ref: str | None = None
    tool_ids: list[str] | None = None
    skill_ids: list[str] | None = None
    max_iterations: int | None = Field(default=None, ge=1, le=100)


def _to_response(emp: object) -> EmployeeResponse:
    return EmployeeResponse(
        id=emp.id,  # type: ignore[attr-defined]
        name=emp.name,  # type: ignore[attr-defined]
        description=emp.description,  # type: ignore[attr-defined]
        system_prompt=emp.system_prompt,  # type: ignore[attr-defined]
        is_lead_agent=emp.is_lead_agent,  # type: ignore[attr-defined]
        tool_ids=list(emp.tool_ids),  # type: ignore[attr-defined]
        skill_ids=list(emp.skill_ids),  # type: ignore[attr-defined]
        max_iterations=emp.max_iterations,  # type: ignore[attr-defined]
        model_ref=emp.model_ref,  # type: ignore[attr-defined]
    )


@router.get("/lead", response_model=EmployeeResponse)
async def get_lead_employee(
    session: AsyncSession = Depends(get_session),
) -> EmployeeResponse:
    svc = await get_employee_service(session)
    lead = await svc.get_lead()
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead agent not found.")
    return _to_response(lead)


@router.get("", response_model=list[EmployeeResponse])
async def list_employees(
    session: AsyncSession = Depends(get_session),
) -> list[EmployeeResponse]:
    svc = await get_employee_service(session)
    employees = await svc.list_all()
    return [_to_response(e) for e in employees]


@router.post("", response_model=EmployeeResponse, status_code=201)
async def create_employee(
    body: EmployeeCreateRequest,
    session: AsyncSession = Depends(get_session),
) -> EmployeeResponse:
    svc = await get_employee_service(session)
    try:
        emp = await svc.create(
            name=body.name,
            description=body.description,
            system_prompt=body.system_prompt,
            model_ref=body.model_ref,
            tool_ids=list(body.tool_ids),
            skill_ids=list(body.skill_ids),
            max_iterations=body.max_iterations,
            created_by="user",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_response(emp)


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
    return _to_response(emp)


@router.patch("/{employee_id}", response_model=EmployeeResponse)
async def update_employee(
    employee_id: str,
    body: EmployeeUpdateRequest,
    session: AsyncSession = Depends(get_session),
) -> EmployeeResponse:
    svc = await get_employee_service(session)
    try:
        emp = await svc.update(
            employee_id,
            description=body.description,
            system_prompt=body.system_prompt,
            model_ref=body.model_ref,
            tool_ids=list(body.tool_ids) if body.tool_ids is not None else None,
            skill_ids=list(body.skill_ids) if body.skill_ids is not None else None,
            max_iterations=body.max_iterations,
        )
    except EmployeeNotFound as exc:
        raise HTTPException(status_code=404, detail=f"Employee {employee_id!r} not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_response(emp)


@router.delete("/{employee_id}", status_code=204)
async def delete_employee(
    employee_id: str,
    session: AsyncSession = Depends(get_session),
) -> Response:
    svc = await get_employee_service(session)
    try:
        await svc.delete(employee_id)
    except EmployeeNotFound as exc:
        raise HTTPException(status_code=404, detail=f"Employee {employee_id!r} not found.") from exc
    return Response(status_code=204)
