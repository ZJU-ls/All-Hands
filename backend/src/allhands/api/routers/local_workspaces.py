"""Local workspace REST endpoints — sibling of /settings/workspaces UI.

Each write verb has a semantic twin in
``execution/tools/meta/local_workspace_tools.py`` (L01 / Tool First).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import (
    AsyncSession,  # noqa: TC002 — runtime-needed for FastAPI Depends resolution
)

from allhands.api.deps import get_session
from allhands.persistence.sql_repos import SqlLocalWorkspaceRepo
from allhands.services.local_workspace_service import (
    LocalWorkspaceService,
    LocalWorkspaceServiceError,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


class WorkspaceResponse(BaseModel):
    id: str
    name: str
    root_path: str
    read_only: bool
    denied_globs: list[str]
    created_at: str
    updated_at: str


class AddWorkspaceRequest(BaseModel):
    name: str
    root_path: str
    read_only: bool = False
    denied_globs: list[str] = []


class UpdateWorkspaceRequest(BaseModel):
    name: str | None = None
    root_path: str | None = None
    read_only: bool | None = None
    denied_globs: list[str] | None = None


def _service(session: AsyncSession) -> LocalWorkspaceService:
    return LocalWorkspaceService(repo=SqlLocalWorkspaceRepo(session))


def _to_response(w: Any) -> WorkspaceResponse:
    return WorkspaceResponse(
        id=w.id,
        name=w.name,
        root_path=w.root_path,
        read_only=w.read_only,
        denied_globs=list(w.denied_globs),
        created_at=w.created_at.isoformat(),
        updated_at=w.updated_at.isoformat(),
    )


@router.get("", response_model=list[WorkspaceResponse])
async def list_workspaces(
    session: AsyncSession = Depends(get_session),
) -> list[WorkspaceResponse]:
    rows = await _service(session).list_all()
    return [_to_response(w) for w in rows]


@router.post("", response_model=WorkspaceResponse, status_code=201)
async def add_workspace(
    body: AddWorkspaceRequest,
    session: AsyncSession = Depends(get_session),
) -> WorkspaceResponse:
    try:
        ws = await _service(session).add(
            name=body.name,
            root_path=body.root_path,
            read_only=body.read_only,
            denied_globs=list(body.denied_globs),
        )
    except LocalWorkspaceServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_response(ws)


@router.patch("/{workspace_id}", response_model=WorkspaceResponse)
async def update_workspace(
    workspace_id: str,
    body: UpdateWorkspaceRequest,
    session: AsyncSession = Depends(get_session),
) -> WorkspaceResponse:
    try:
        ws = await _service(session).update(
            workspace_id,
            name=body.name,
            root_path=body.root_path,
            read_only=body.read_only,
            denied_globs=body.denied_globs,
        )
    except LocalWorkspaceServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_response(ws)


@router.delete("/{workspace_id}", status_code=204)
async def remove_workspace(
    workspace_id: str,
    session: AsyncSession = Depends(get_session),
) -> None:
    await _service(session).delete(workspace_id)
