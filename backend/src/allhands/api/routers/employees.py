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

from typing import TYPE_CHECKING, Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from allhands.api.deps import (
    get_employee_service,
    get_session,
    get_skill_registry,
)
from allhands.core.errors import DomainError, EmployeeNotFound
from allhands.execution.modes import PRESETS, compose_preview
from allhands.persistence.sql_repos import SqlLLMProviderRepo, SqlMCPServerRepo
from allhands.services import ai_explainer

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

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
    status: Literal["draft", "published"]
    published_at: str | None = None


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
    # New employees POSTed from the UI / Meta Tool default to ``draft`` so
    # they can be iterated on in /employees/design without surfacing on the
    # roster. The Lead Agent may override to ``published`` when it creates
    # an employee that's ready to ship.
    status: Literal["draft", "published"] = "draft"


class EmployeeUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str | None = None
    system_prompt: str | None = None
    model_ref: str | None = None
    tool_ids: list[str] | None = None
    skill_ids: list[str] | None = None
    max_iterations: int | None = Field(default=None, ge=1, le=100)


Preset = Literal["execute", "plan", "plan_with_subagent"]


class EmployeePreviewRequest(BaseModel):
    """Phase 3B preset-expansion 请求 · 只计算展开结果,不落库。

    §3.2 红线:forbid extra → rogue ``mode`` 字段直接 422;响应里也不暴露
    ``preset`` / ``mode`` 字样,以免前端误把它当作持久化字段。
    """

    model_config = ConfigDict(extra="forbid")

    preset: Preset
    custom_tool_ids: list[str] = Field(default_factory=list)
    custom_skill_ids: list[str] | None = None
    custom_max_iterations: int | None = Field(default=None, ge=1, le=50)


class EmployeePreviewResponse(BaseModel):
    tool_ids: list[str]
    skill_ids: list[str]
    max_iterations: int


def _to_response(emp: object) -> EmployeeResponse:
    published_at = emp.published_at  # type: ignore[attr-defined]
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
        status=emp.status,  # type: ignore[attr-defined]
        published_at=published_at.isoformat() if published_at else None,
    )


class ComposePromptRequest(BaseModel):
    """Inputs for the AI-drafted system_prompt helper.

    All fields are optional — when the user has only filled in a name
    we still produce something useful (the model infers the rest from
    the name + picked skills). The form lives at ``/employees/[id]``
    and ``/employees/design``; both reuse this endpoint.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(default="", max_length=128)
    description: str = Field(default="", max_length=2000)
    skill_ids: list[str] = Field(default_factory=list)
    mcp_server_ids: list[str] = Field(default_factory=list)


@router.post("/compose-prompt")
async def compose_employee_prompt(
    body: ComposePromptRequest,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    """Stream a draft ``system_prompt`` for a yet-to-be-saved employee.

    The chip on the textarea calls this; the response body streams plain
    text so the frontend's ``getReader()`` loop can append chunks live.
    No persistence — caller decides whether to write the draft into the
    form. The picked skills + MCP servers must reference real installed
    rows; unknown ids are silently dropped (we don't want a strict-fail
    blocking the user from iterating on the form).
    """

    async def _gen() -> AsyncIterator[bytes]:
        try:
            async for chunk in ai_explainer.compose_employee_prompt_stream(
                name=body.name,
                description=body.description,
                skill_ids=list(body.skill_ids),
                mcp_server_ids=list(body.mcp_server_ids),
                provider_repo=SqlLLMProviderRepo(session),
                skill_registry=get_skill_registry(),
                mcp_repo=SqlMCPServerRepo(session),
            ):
                if chunk:
                    yield chunk.encode("utf-8")
        except DomainError as exc:
            yield f"\n\n[错误] {exc}".encode()

    return StreamingResponse(_gen(), media_type="text/plain; charset=utf-8")


@router.post("/preview", response_model=EmployeePreviewResponse)
async def preview_employee_composition(
    body: EmployeePreviewRequest,
) -> EmployeePreviewResponse:
    """Phase 3B · 把 UI 的 ``preset`` 概念展开为 ``(tool_ids, skill_ids,
    max_iterations)`` 三列表示,**不落库**、**不触发 Gate**。Meta Tool
    ``preview_employee_composition`` 是等价入口(L01 扩展 · §3.1),两者共用
    ``allhands.execution.modes.compose_preview`` 作为唯一展开算法。

    §3.2 红线:request / response 都不出现 ``mode`` / ``preset`` 字样。
    """
    if body.preset not in PRESETS:
        raise HTTPException(status_code=400, detail=f"Unknown preset {body.preset!r}")
    preview = compose_preview(
        PRESETS[body.preset],
        custom_tool_ids=list(body.custom_tool_ids),
        custom_skill_ids=list(body.custom_skill_ids) if body.custom_skill_ids is not None else None,
        custom_max_iterations=body.custom_max_iterations,
    )
    return EmployeePreviewResponse(
        tool_ids=preview.tool_ids,
        skill_ids=preview.skill_ids,
        max_iterations=preview.max_iterations,
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
    status: Literal["draft", "published"] | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[EmployeeResponse]:
    """Browse list. ``status`` filter:
    - omitted → every employee (used by the design desk which shows both)
    - ``published`` → roster surfaces (home grid / @mentions / picker)
    - ``draft`` → design-desk drafts tab
    """
    svc = await get_employee_service(session)
    employees = await svc.list_all(status=status)
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
            status=body.status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_response(emp)


@router.post("/{employee_id}/publish", response_model=EmployeeResponse)
async def publish_employee(
    employee_id: str,
    session: AsyncSession = Depends(get_session),
) -> EmployeeResponse:
    """Flip a draft to published. Idempotent when already published."""
    svc = await get_employee_service(session)
    try:
        emp = await svc.publish(employee_id)
    except EmployeeNotFound as exc:
        raise HTTPException(status_code=404, detail=f"Employee {employee_id!r} not found.") from exc
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
