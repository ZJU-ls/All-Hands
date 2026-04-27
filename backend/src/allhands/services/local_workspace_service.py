"""LocalWorkspaceService · CRUD + path resolution helpers.

The workspace concept gates all 7 ``allhands.local-files`` tools — without a
configured workspace they refuse with ``error="no workspace configured"``.

Paths are stored canonical: every ``add`` / ``update`` runs
``Path(root_path).resolve(strict=True)`` and rejects:
- non-existent paths
- non-directories
- root ``/``
- the user's HOME root (too broad — ask for a sub-dir)

The service exposes :meth:`resolve_within` which is the single chokepoint
all file tools call: ``resolve_within(workspace_id, requested_path)`` returns
an absolute resolved Path or raises :class:`PathOutsideWorkspaceError`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from allhands.core import LocalWorkspace

if TYPE_CHECKING:
    from allhands.persistence.repositories import LocalWorkspaceRepo


class LocalWorkspaceServiceError(Exception):
    """Raised for validation / not-found / duplicate-name conditions."""


class PathOutsideWorkspaceError(Exception):
    """The requested path resolves outside any workspace root."""


_FORBIDDEN_ROOTS = {"/", ""}


class LocalWorkspaceService:
    def __init__(self, *, repo: LocalWorkspaceRepo) -> None:
        self._repo = repo

    async def list_all(self) -> list[LocalWorkspace]:
        return await self._repo.list_all()

    async def get(self, workspace_id: str) -> LocalWorkspace | None:
        return await self._repo.get(workspace_id)

    async def add(
        self,
        *,
        name: str,
        root_path: str,
        read_only: bool = False,
        denied_globs: list[str] | None = None,
    ) -> LocalWorkspace:
        name = name.strip()
        if not name:
            raise LocalWorkspaceServiceError("name must not be empty")
        existing = await self._repo.get_by_name(name)
        if existing is not None:
            raise LocalWorkspaceServiceError(f"workspace named {name!r} already exists")

        canonical = self._canonicalise(root_path)

        now = datetime.now(UTC)
        workspace = LocalWorkspace(
            id=str(uuid.uuid4()),
            name=name,
            root_path=str(canonical),
            read_only=read_only,
            denied_globs=list(denied_globs or []),
            created_at=now,
            updated_at=now,
        )
        return await self._repo.upsert(workspace)

    async def update(
        self,
        workspace_id: str,
        *,
        name: str | None = None,
        root_path: str | None = None,
        read_only: bool | None = None,
        denied_globs: list[str] | None = None,
    ) -> LocalWorkspace:
        existing = await self._repo.get(workspace_id)
        if existing is None:
            raise LocalWorkspaceServiceError(f"workspace {workspace_id!r} not found")

        new_name = (name or existing.name).strip()
        if name is not None and new_name != existing.name:
            clash = await self._repo.get_by_name(new_name)
            if clash and clash.id != workspace_id:
                raise LocalWorkspaceServiceError(f"workspace named {new_name!r} already exists")

        new_root = (
            str(self._canonicalise(root_path)) if root_path is not None else existing.root_path
        )

        updated = existing.model_copy(
            update={
                "name": new_name,
                "root_path": new_root,
                "read_only": existing.read_only if read_only is None else read_only,
                "denied_globs": (
                    list(denied_globs) if denied_globs is not None else existing.denied_globs
                ),
                "updated_at": datetime.now(UTC),
            }
        )
        return await self._repo.upsert(updated)

    async def delete(self, workspace_id: str) -> None:
        await self._repo.delete(workspace_id)

    async def resolve_within(
        self,
        workspace_id: str,
        requested_path: str,
    ) -> Path:
        """Resolve ``requested_path`` and require it to be inside the workspace root.

        - Absolute paths are taken as-is.
        - Relative paths are anchored at the workspace root.
        - Symlinks and ``..`` components are normalised by ``Path.resolve()``.
        - The result must be ``is_relative_to(root)`` — otherwise raises.

        We do **not** require the path to exist (callers may be creating
        files); only the root must exist.
        """
        ws = await self._repo.get(workspace_id)
        if ws is None:
            raise LocalWorkspaceServiceError(f"workspace {workspace_id!r} not found")
        root = Path(ws.root_path).resolve(strict=True)  # noqa: ASYNC240  # path resolution is sync · OS lookup is fast
        candidate = Path(requested_path)
        if not candidate.is_absolute():
            candidate = root / candidate
        # ``resolve(strict=False)`` so non-existent files (about-to-create) work
        resolved = candidate.resolve(strict=False)
        try:
            resolved.relative_to(root)
        except ValueError as exc:
            raise PathOutsideWorkspaceError(
                f"path {requested_path!r} resolves to {resolved} which is outside "
                f"workspace root {root}"
            ) from exc
        return resolved

    @staticmethod
    def _canonicalise(root_path: str) -> Path:
        if root_path is None or root_path.strip() in _FORBIDDEN_ROOTS:
            raise LocalWorkspaceServiceError("root_path must not be empty or filesystem root")
        path = Path(root_path).expanduser()
        try:
            resolved = path.resolve(strict=True)
        except (FileNotFoundError, OSError) as exc:
            raise LocalWorkspaceServiceError(f"root_path {root_path!r} does not exist") from exc
        if not resolved.is_dir():
            raise LocalWorkspaceServiceError(f"root_path {root_path!r} is not a directory")
        if str(resolved) == "/":
            raise LocalWorkspaceServiceError("root_path must not be filesystem root '/'")
        # Reject HOME root specifically — too broad. User can pick HOME/code etc.
        try:
            home = Path("~").expanduser().resolve()
            if resolved == home:
                raise LocalWorkspaceServiceError(
                    "root_path must not be your HOME directory; pick a sub-folder"
                )
        except RuntimeError:
            pass
        return resolved
