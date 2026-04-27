"""Executor factories for local-workspace meta tools.

Lives in ``api/`` because they close over ``LocalWorkspaceService`` (services/) —
``execution/`` cannot import services/. Wired via
``discover_builtin_tools(extra_executors=...)``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from allhands.persistence.sql_repos import SqlLocalWorkspaceRepo
from allhands.services.local_workspace_service import (
    LocalWorkspaceService,
    LocalWorkspaceServiceError,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    ToolExecutor = Callable[..., Awaitable[Any]]


def _session_context(maker: async_sessionmaker[AsyncSession]) -> Any:
    session = maker()

    class _Ctx:
        async def __aenter__(self) -> AsyncSession:
            await session.__aenter__()
            await session.begin()
            return session

        async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
            if exc is None:
                await session.commit()
            else:
                await session.rollback()
            await session.__aexit__(exc_type, exc, tb)

    return _Ctx()


def _dump(workspace: Any) -> dict[str, Any]:
    if hasattr(workspace, "model_dump"):
        data: dict[str, Any] = workspace.model_dump(mode="json")
        return data
    return {"repr": str(workspace)}


def build_local_workspace_executors(
    maker: async_sessionmaker[AsyncSession],
) -> dict[str, ToolExecutor]:
    def _service(session: AsyncSession) -> LocalWorkspaceService:
        return LocalWorkspaceService(repo=SqlLocalWorkspaceRepo(session))

    async def list_local_workspaces(**_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _service(session)
            rows = await svc.list_all()
        return {"workspaces": [_dump(w) for w in rows], "count": len(rows)}

    async def add_local_workspace(
        name: str,
        root_path: str,
        read_only: bool = False,
        denied_globs: list[str] | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _service(session)
            try:
                ws = await svc.add(
                    name=name,
                    root_path=root_path,
                    read_only=read_only,
                    denied_globs=denied_globs,
                )
            except LocalWorkspaceServiceError as exc:
                return {
                    "error": str(exc),
                    "field": "name|root_path",
                    "hint": "ensure name is unique and root_path points to an existing directory",
                }
        return {"workspace": _dump(ws)}

    async def update_local_workspace(
        workspace_id: str,
        name: str | None = None,
        root_path: str | None = None,
        read_only: bool | None = None,
        denied_globs: list[str] | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _service(session)
            try:
                ws = await svc.update(
                    workspace_id,
                    name=name,
                    root_path=root_path,
                    read_only=read_only,
                    denied_globs=denied_globs,
                )
            except LocalWorkspaceServiceError as exc:
                return {
                    "error": str(exc),
                    "field": "workspace_id|name|root_path",
                    "hint": "list_local_workspaces to find the right id",
                }
        return {"workspace": _dump(ws)}

    async def remove_local_workspace(workspace_id: str, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _service(session)
            await svc.delete(workspace_id)
        return {"workspace_id": workspace_id, "deleted": True}

    return {
        "allhands.meta.list_local_workspaces": list_local_workspaces,
        "allhands.meta.add_local_workspace": add_local_workspace,
        "allhands.meta.update_local_workspace": update_local_workspace,
        "allhands.meta.remove_local_workspace": remove_local_workspace,
    }
