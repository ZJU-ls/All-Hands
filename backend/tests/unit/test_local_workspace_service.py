"""Unit tests for LocalWorkspaceService — CRUD + path resolution."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from allhands.core import LocalWorkspace
from allhands.services.local_workspace_service import (
    LocalWorkspaceService,
    LocalWorkspaceServiceError,
    PathOutsideWorkspaceError,
)


class _InMemRepo:
    def __init__(self) -> None:
        self._data: dict[str, LocalWorkspace] = {}

    async def get(self, workspace_id: str) -> LocalWorkspace | None:
        return self._data.get(workspace_id)

    async def get_by_name(self, name: str) -> LocalWorkspace | None:
        for w in self._data.values():
            if w.name == name:
                return w
        return None

    async def list_all(self) -> list[LocalWorkspace]:
        return sorted(self._data.values(), key=lambda w: w.created_at)

    async def upsert(self, workspace: LocalWorkspace) -> LocalWorkspace:
        self._data[workspace.id] = workspace
        return workspace

    async def delete(self, workspace_id: str) -> None:
        self._data.pop(workspace_id, None)


@pytest.fixture
def tmp_root() -> Path:
    return Path(tempfile.mkdtemp(prefix="alhw-")).resolve()


@pytest.mark.asyncio
async def test_add_canonicalises_root_path(tmp_root: Path) -> None:
    svc = LocalWorkspaceService(repo=_InMemRepo())
    ws = await svc.add(name="code", root_path=str(tmp_root))
    assert Path(ws.root_path) == tmp_root.resolve()


@pytest.mark.asyncio
async def test_add_rejects_nonexistent_path() -> None:
    svc = LocalWorkspaceService(repo=_InMemRepo())
    with pytest.raises(LocalWorkspaceServiceError, match="does not exist"):
        await svc.add(name="x", root_path="/this/does/not/exist/anywhere")


@pytest.mark.asyncio
async def test_add_rejects_filesystem_root() -> None:
    svc = LocalWorkspaceService(repo=_InMemRepo())
    with pytest.raises(LocalWorkspaceServiceError):
        await svc.add(name="x", root_path="/")


@pytest.mark.asyncio
async def test_add_rejects_home_root() -> None:
    svc = LocalWorkspaceService(repo=_InMemRepo())
    with pytest.raises(LocalWorkspaceServiceError, match="HOME"):
        await svc.add(name="x", root_path=str(Path.home()))


@pytest.mark.asyncio
async def test_add_rejects_file_path(tmp_root: Path) -> None:
    f = tmp_root / "a.txt"
    f.write_text("x")
    svc = LocalWorkspaceService(repo=_InMemRepo())
    with pytest.raises(LocalWorkspaceServiceError, match="not a directory"):
        await svc.add(name="x", root_path=str(f))


@pytest.mark.asyncio
async def test_add_rejects_duplicate_name(tmp_root: Path) -> None:
    svc = LocalWorkspaceService(repo=_InMemRepo())
    await svc.add(name="dup", root_path=str(tmp_root))
    with pytest.raises(LocalWorkspaceServiceError, match="already exists"):
        await svc.add(name="dup", root_path=str(tmp_root))


@pytest.mark.asyncio
async def test_resolve_within_accepts_relative(tmp_root: Path) -> None:
    (tmp_root / "sub").mkdir()
    svc = LocalWorkspaceService(repo=_InMemRepo())
    ws = await svc.add(name="r", root_path=str(tmp_root))
    resolved = await svc.resolve_within(ws.id, "sub/file.py")
    assert resolved == (tmp_root / "sub" / "file.py").resolve()


@pytest.mark.asyncio
async def test_resolve_within_accepts_absolute_inside(tmp_root: Path) -> None:
    svc = LocalWorkspaceService(repo=_InMemRepo())
    ws = await svc.add(name="r", root_path=str(tmp_root))
    target = tmp_root / "x.py"
    resolved = await svc.resolve_within(ws.id, str(target))
    assert resolved == target.resolve()


@pytest.mark.asyncio
async def test_resolve_within_rejects_dotdot_escape(tmp_root: Path) -> None:
    svc = LocalWorkspaceService(repo=_InMemRepo())
    ws = await svc.add(name="r", root_path=str(tmp_root))
    with pytest.raises(PathOutsideWorkspaceError):
        await svc.resolve_within(ws.id, "../../etc/passwd")


@pytest.mark.asyncio
async def test_resolve_within_rejects_absolute_outside(tmp_root: Path) -> None:
    svc = LocalWorkspaceService(repo=_InMemRepo())
    ws = await svc.add(name="r", root_path=str(tmp_root))
    with pytest.raises(PathOutsideWorkspaceError):
        await svc.resolve_within(ws.id, "/etc/passwd")


@pytest.mark.asyncio
async def test_resolve_within_rejects_symlink_escape(tmp_root: Path) -> None:
    """A symlink inside the workspace pointing outside must be rejected on
    resolve — this is the core attack vector."""
    outside = Path(tempfile.mkdtemp(prefix="alhw-out-")).resolve()
    (outside / "secret.txt").write_text("x")
    link = tmp_root / "link"
    link.symlink_to(outside / "secret.txt")
    svc = LocalWorkspaceService(repo=_InMemRepo())
    ws = await svc.add(name="r", root_path=str(tmp_root))
    with pytest.raises(PathOutsideWorkspaceError):
        await svc.resolve_within(ws.id, "link")


@pytest.mark.asyncio
async def test_resolve_within_unknown_workspace() -> None:
    svc = LocalWorkspaceService(repo=_InMemRepo())
    with pytest.raises(LocalWorkspaceServiceError, match="not found"):
        await svc.resolve_within("nope", "x")


@pytest.mark.asyncio
async def test_update_changes_fields(tmp_root: Path) -> None:
    svc = LocalWorkspaceService(repo=_InMemRepo())
    ws = await svc.add(name="r", root_path=str(tmp_root))
    other = Path(tempfile.mkdtemp(prefix="alhw2-")).resolve()
    updated = await svc.update(
        ws.id,
        name="renamed",
        root_path=str(other),
        read_only=True,
        denied_globs=["*.env"],
    )
    assert updated.name == "renamed"
    assert Path(updated.root_path) == other
    assert updated.read_only is True
    assert updated.denied_globs == ["*.env"]


@pytest.mark.asyncio
async def test_update_rejects_name_collision(tmp_root: Path) -> None:
    other = Path(tempfile.mkdtemp(prefix="alhw3-")).resolve()
    svc = LocalWorkspaceService(repo=_InMemRepo())
    await svc.add(name="a", root_path=str(tmp_root))
    b = await svc.add(name="b", root_path=str(other))
    with pytest.raises(LocalWorkspaceServiceError, match="already exists"):
        await svc.update(b.id, name="a")


@pytest.mark.asyncio
async def test_delete(tmp_root: Path) -> None:
    svc = LocalWorkspaceService(repo=_InMemRepo())
    ws = await svc.add(name="r", root_path=str(tmp_root))
    await svc.delete(ws.id)
    assert await svc.get(ws.id) is None
