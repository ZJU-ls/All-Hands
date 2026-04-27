"""M4 · write_local_file / edit_file."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from allhands.core import LocalWorkspace


class _InMemRepo:
    def __init__(self, seed: list[LocalWorkspace]) -> None:
        self._data = {w.id: w for w in seed}

    async def get(self, workspace_id: str) -> LocalWorkspace | None:
        return self._data.get(workspace_id)

    async def get_by_name(self, name: str) -> LocalWorkspace | None:
        for w in self._data.values():
            if w.name == name:
                return w
        return None

    async def list_all(self) -> list[LocalWorkspace]:
        return list(self._data.values())

    async def upsert(self, w: LocalWorkspace) -> LocalWorkspace:
        self._data[w.id] = w
        return w

    async def delete(self, workspace_id: str) -> None:
        self._data.pop(workspace_id, None)


class _StubMaker:
    def __call__(self) -> Any:
        return _StubSession()


class _StubSession:
    async def __aenter__(self) -> _StubSession:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def begin(self) -> _BeginCM:
        return _BeginCM()

    async def commit(self) -> None:
        return None

    async def rollback(self) -> None:
        return None


class _BeginCM:
    async def __aenter__(self) -> _BeginCM:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None


@pytest.fixture
def workspace(tmp_path_factory: pytest.TempPathFactory) -> LocalWorkspace:
    root = tmp_path_factory.mktemp("ws-we").resolve()
    now = datetime.now(UTC)
    return LocalWorkspace(
        id="ws-1",
        name="ws",
        root_path=str(root),
        read_only=False,
        denied_globs=[],
        created_at=now,
        updated_at=now,
    )


@pytest.fixture
def executors(monkeypatch: pytest.MonkeyPatch, workspace: LocalWorkspace) -> dict[str, Any]:
    from allhands.api import local_files_executors as mod

    repo = _InMemRepo([workspace])
    monkeypatch.setattr(mod, "SqlLocalWorkspaceRepo", lambda _s: repo)
    return mod.build_local_files_executors(_StubMaker())


# ---- write_local_file ----


@pytest.mark.asyncio
async def test_write_creates_new_file(executors: dict[str, Any], workspace: LocalWorkspace) -> None:
    out = await executors["allhands.local.write_file"](
        workspace_id="ws-1", path="hello.py", content="print('hi')\n"
    )
    assert out["created"] is True
    assert out["bytes_written"] > 0
    assert (Path(workspace.root_path) / "hello.py").read_text() == "print('hi')\n"


@pytest.mark.asyncio
async def test_write_overwrites_existing(
    executors: dict[str, Any], workspace: LocalWorkspace
) -> None:
    f = Path(workspace.root_path) / "x.txt"
    f.write_text("old")
    out = await executors["allhands.local.write_file"](
        workspace_id="ws-1", path="x.txt", content="new"
    )
    assert out["created"] is False
    assert f.read_text() == "new"


@pytest.mark.asyncio
async def test_write_creates_parent_dirs(
    executors: dict[str, Any], workspace: LocalWorkspace
) -> None:
    out = await executors["allhands.local.write_file"](
        workspace_id="ws-1", path="deep/nested/x.txt", content="hi"
    )
    assert out["created"] is True
    assert (Path(workspace.root_path) / "deep/nested/x.txt").read_text() == "hi"


@pytest.mark.asyncio
async def test_write_outside_workspace_rejected(
    executors: dict[str, Any], workspace: LocalWorkspace
) -> None:
    out = await executors["allhands.local.write_file"](
        workspace_id="ws-1", path="/etc/passwd", content="x"
    )
    assert "error" in out


@pytest.mark.asyncio
async def test_write_to_directory_path_rejected(
    executors: dict[str, Any], workspace: LocalWorkspace
) -> None:
    (Path(workspace.root_path) / "sub").mkdir()
    out = await executors["allhands.local.write_file"](workspace_id="ws-1", path="sub", content="x")
    assert "error" in out


@pytest.mark.asyncio
async def test_write_blocked_in_read_only_workspace(
    monkeypatch: pytest.MonkeyPatch, workspace: LocalWorkspace
) -> None:
    from allhands.api import local_files_executors as mod

    ro = workspace.model_copy(update={"read_only": True})
    repo = _InMemRepo([ro])
    monkeypatch.setattr(mod, "SqlLocalWorkspaceRepo", lambda _s: repo)
    bundle = mod.build_local_files_executors(_StubMaker())
    out = await bundle["allhands.local.write_file"](workspace_id="ws-1", path="x.txt", content="hi")
    assert "error" in out
    assert "read_only" in out["error"]


# ---- edit_file ----


@pytest.mark.asyncio
async def test_edit_unique_replace(executors: dict[str, Any], workspace: LocalWorkspace) -> None:
    f = Path(workspace.root_path) / "a.py"
    f.write_text("def foo():\n    return 1\n")
    out = await executors["allhands.local.edit_file"](
        workspace_id="ws-1",
        path="a.py",
        old_string="return 1",
        new_string="return 42",
    )
    assert out["replacements"] == 1
    assert f.read_text() == "def foo():\n    return 42\n"


@pytest.mark.asyncio
async def test_edit_old_string_not_found(
    executors: dict[str, Any], workspace: LocalWorkspace
) -> None:
    f = Path(workspace.root_path) / "a.py"
    f.write_text("hello")
    out = await executors["allhands.local.edit_file"](
        workspace_id="ws-1", path="a.py", old_string="xxx", new_string="yyy"
    )
    assert "error" in out
    assert "not found" in out["error"]
    assert "grep" in out["hint"]


@pytest.mark.asyncio
async def test_edit_non_unique_without_replace_all(
    executors: dict[str, Any], workspace: LocalWorkspace
) -> None:
    f = Path(workspace.root_path) / "a.py"
    f.write_text("foo\nfoo\n")
    out = await executors["allhands.local.edit_file"](
        workspace_id="ws-1", path="a.py", old_string="foo", new_string="bar"
    )
    assert "error" in out
    assert out["occurrences"] == 2
    assert out["first_match_line"] == 1


@pytest.mark.asyncio
async def test_edit_replace_all(executors: dict[str, Any], workspace: LocalWorkspace) -> None:
    f = Path(workspace.root_path) / "a.py"
    f.write_text("foo\nfoo\nfoo\n")
    out = await executors["allhands.local.edit_file"](
        workspace_id="ws-1",
        path="a.py",
        old_string="foo",
        new_string="bar",
        replace_all=True,
    )
    assert out["replacements"] == 3
    assert f.read_text() == "bar\nbar\nbar\n"


@pytest.mark.asyncio
async def test_edit_missing_file(executors: dict[str, Any], workspace: LocalWorkspace) -> None:
    out = await executors["allhands.local.edit_file"](
        workspace_id="ws-1", path="nope.py", old_string="x", new_string="y"
    )
    assert "error" in out
    assert "does not exist" in out["error"]
    assert "write_local_file" in out["hint"]


@pytest.mark.asyncio
async def test_edit_old_equals_new(executors: dict[str, Any], workspace: LocalWorkspace) -> None:
    out = await executors["allhands.local.edit_file"](
        workspace_id="ws-1", path="x.py", old_string="abc", new_string="abc"
    )
    assert "error" in out
    assert "nothing to change" in out["error"]
