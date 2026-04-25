"""Task REST endpoints — per spec `docs/specs/agent-design/2026-04-18-tasks.md` § 6.

Thin wrapper over `TaskService`. Meta tools (`execution/tools/meta/task_tools.py`)
call the **same** service with identical semantics; L01 Tool First requires
REST + Meta Tool parity — any behavioural drift here must be mirrored there.

`POST /api/tasks` is a WRITE from the UI directly (L01 § "REST-only OK" doesn't
apply to tasks; tasks are agent-managed but user-facing, so BOTH surfaces are
valid). The meta tool equivalent is `allhands.meta.tasks.create` and carries
`requires_confirmation=True` for Lead-initiated creation.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: TC002

from allhands.api.deps import get_session
from allhands.core import Task, TaskSource, TaskStatus
from allhands.i18n import t as _t
from allhands.persistence.sql_repos import SqlTaskRepo
from allhands.services.task_service import (
    TaskError,
    TaskNotFound,
    TaskService,
    TaskTransitionError,
)

router = APIRouter(prefix="/tasks", tags=["tasks"])


async def get_task_service(
    session: AsyncSession = Depends(get_session),
) -> TaskService:
    return TaskService(SqlTaskRepo(session))


class TaskResponse(BaseModel):
    id: str
    workspace_id: str
    title: str
    goal: str
    dod: str
    assignee_id: str
    status: str
    source: str
    created_by: str
    parent_task_id: str | None
    run_ids: list[str]
    artifact_ids: list[str]
    conversation_id: str | None
    result_summary: str | None
    error_summary: str | None
    pending_input_question: str | None
    pending_approval_payload: dict[str, Any] | None
    token_budget: int | None
    tokens_used: int
    created_at: str
    updated_at: str
    completed_at: str | None


class CreateTaskRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=256)
    goal: str = Field(..., min_length=1)
    dod: str = Field(..., min_length=1)
    assignee_id: str = Field(..., min_length=1)
    token_budget: int | None = Field(default=None, ge=1)
    source: str | None = Field(default="user")
    created_by: str | None = Field(default="user")


class AnswerInputRequest(BaseModel):
    answer: str = Field(..., min_length=1)


class ApproveRequest(BaseModel):
    decision: str = Field(..., pattern="^(approved|denied)$")
    note: str | None = None


class CancelRequest(BaseModel):
    reason: str | None = None


def _to_response(task: Task) -> TaskResponse:
    return TaskResponse(
        id=task.id,
        workspace_id=task.workspace_id,
        title=task.title,
        goal=task.goal,
        dod=task.dod,
        assignee_id=task.assignee_id,
        status=task.status.value,
        source=task.source.value,
        created_by=task.created_by,
        parent_task_id=task.parent_task_id,
        run_ids=list(task.run_ids),
        artifact_ids=list(task.artifact_ids),
        conversation_id=task.conversation_id,
        result_summary=task.result_summary,
        error_summary=task.error_summary,
        pending_input_question=task.pending_input_question,
        pending_approval_payload=task.pending_approval_payload,
        token_budget=task.token_budget,
        tokens_used=task.tokens_used,
        created_at=task.created_at.isoformat(),
        updated_at=task.updated_at.isoformat(),
        completed_at=task.completed_at.isoformat() if task.completed_at else None,
    )


@router.get("", response_model=list[TaskResponse])
async def list_tasks(
    status: list[str] | None = Query(default=None),
    assignee_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    svc: TaskService = Depends(get_task_service),
) -> list[TaskResponse]:
    parsed: list[TaskStatus] | None = None
    if status:
        try:
            parsed = [TaskStatus(s) for s in status]
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail=_t("errors.invalid_status_filter", detail=str(exc))
            ) from exc
    tasks = await svc.list_all(statuses=parsed, assignee_id=assignee_id, limit=limit)
    return [_to_response(t) for t in tasks]


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: str,
    svc: TaskService = Depends(get_task_service),
) -> TaskResponse:
    try:
        task = await svc.get(task_id)
    except TaskNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return _to_response(task)


@router.post("", response_model=TaskResponse, status_code=201)
async def create_task(
    body: CreateTaskRequest,
    svc: TaskService = Depends(get_task_service),
) -> TaskResponse:
    try:
        source = TaskSource(body.source or "user")
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=_t("errors.invalid_source", detail=str(exc))
        ) from exc
    try:
        task = await svc.create(
            title=body.title,
            goal=body.goal,
            dod=body.dod,
            assignee_id=body.assignee_id,
            source=source,
            created_by=body.created_by or "user",
            token_budget=body.token_budget,
        )
    except TaskError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_response(task)


@router.post("/{task_id}/cancel", response_model=TaskResponse)
async def cancel_task(
    task_id: str,
    body: CancelRequest | None = None,
    svc: TaskService = Depends(get_task_service),
) -> TaskResponse:
    try:
        task = await svc.cancel(task_id, reason=(body.reason if body else None))
    except TaskNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except TaskTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _to_response(task)


@router.post("/{task_id}/answer", response_model=TaskResponse)
async def answer_task(
    task_id: str,
    body: AnswerInputRequest,
    svc: TaskService = Depends(get_task_service),
) -> TaskResponse:
    try:
        task = await svc.answer_input(task_id, body.answer)
    except TaskNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except TaskTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except TaskError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_response(task)


@router.post("/{task_id}/approve", response_model=TaskResponse)
async def approve_task(
    task_id: str,
    body: ApproveRequest,
    svc: TaskService = Depends(get_task_service),
) -> TaskResponse:
    try:
        task = await svc.approve(task_id, decision=body.decision, note=body.note)
    except TaskNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except TaskTransitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except TaskError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_response(task)
