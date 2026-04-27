"""M2 · read_file / list_directory / glob executors against an in-mem repo."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import pytest

from allhands.core import LocalWorkspace


# --------------- in-mem maker that returns sessions which our patched
# SqlLocalWorkspaceRepo factory will ignore. We patch the executor module's
# repo class to a fake repo bound to the test's data.
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

    async def upsert(self, workspace: LocalWorkspace) -> LocalWorkspace:
        self._data[workspace.id] = workspace
        return workspace

    async def delete(self, workspace_id: str) -> None:
        self._data.pop(workspace_id, None)


class _StubMaker:
    """Stub asyncio sessionmaker — never actually used because we patch
    SqlLocalWorkspaceRepo to ignore the session arg."""

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
    root = tmp_path_factory.mktemp("ws-root").resolve()
    from datetime import UTC, datetime

    now = datetime.now(UTC)
    return LocalWorkspace(
        id="ws-1",
        name="testws",
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


# ---- read_file ----


@pytest.mark.asyncio
async def test_read_file_returns_numbered_lines(
    executors: dict[str, Any], workspace: LocalWorkspace
) -> None:
    f = Path(workspace.root_path) / "x.txt"
    f.write_text("alpha\nbravo\ncharlie\n")
    out = await executors["allhands.local.read_file"](workspace_id="ws-1", path="x.txt")
    assert out["line_count"] == 3
    assert out["lines_returned"] == 3
    assert "1\talpha" in out["content"]
    assert "3\tcharlie" in out["content"]
    assert out["truncated"] is False


@pytest.mark.asyncio
async def test_read_file_offset_limit(executors: dict[str, Any], workspace: LocalWorkspace) -> None:
    f = Path(workspace.root_path) / "big.txt"
    f.write_text("\n".join(f"line{i}" for i in range(100)))
    out = await executors["allhands.local.read_file"](
        workspace_id="ws-1", path="big.txt", offset=50, limit=10
    )
    assert out["lines_returned"] == 10
    # offset=50 means start at index 50 → file line numbers 51..60 (1-indexed)
    assert "    51\tline50" in out["content"]
    assert "    60\tline59" in out["content"]
    assert "line60" not in out["content"]
    assert out["truncated"] is True


@pytest.mark.asyncio
async def test_read_file_missing(executors: dict[str, Any], workspace: LocalWorkspace) -> None:
    out = await executors["allhands.local.read_file"](workspace_id="ws-1", path="nope.txt")
    assert "error" in out
    assert "does not exist" in out["error"]


@pytest.mark.asyncio
async def test_read_file_outside_workspace(
    executors: dict[str, Any], workspace: LocalWorkspace
) -> None:
    out = await executors["allhands.local.read_file"](workspace_id="ws-1", path="/etc/passwd")
    assert "error" in out
    assert out["field"] == "path"


@pytest.mark.asyncio
async def test_read_file_no_workspace_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Zero workspace configured → helpful structured error."""
    from allhands.api import local_files_executors as mod

    repo = _InMemRepo([])
    monkeypatch.setattr(mod, "SqlLocalWorkspaceRepo", lambda _s: repo)
    bundle = mod.build_local_files_executors(_StubMaker())
    out = await bundle["allhands.local.read_file"](path="x.txt")
    assert "error" in out
    assert "no workspace" in out["error"]
    assert "/settings/workspaces" in out["hint"]


@pytest.mark.asyncio
async def test_read_file_binary_returns_kind(
    executors: dict[str, Any], workspace: LocalWorkspace
) -> None:
    f = Path(workspace.root_path) / "bin"
    f.write_bytes(b"\x00\x01\x02PNGblob")
    out = await executors["allhands.local.read_file"](workspace_id="ws-1", path="bin")
    assert out["kind"] == "binary"
    assert "size_bytes" in out


@pytest.mark.asyncio
async def test_read_file_dir_path_rejected(
    executors: dict[str, Any], workspace: LocalWorkspace
) -> None:
    (Path(workspace.root_path) / "sub").mkdir()
    out = await executors["allhands.local.read_file"](workspace_id="ws-1", path="sub")
    assert "error" in out
    assert "directory" in out["error"]


# ---- list_directory ----


@pytest.mark.asyncio
async def test_list_directory_default_root(
    executors: dict[str, Any], workspace: LocalWorkspace
) -> None:
    root = Path(workspace.root_path)
    (root / "a.txt").write_text("x")
    (root / "sub").mkdir()
    out = await executors["allhands.local.list_directory"](workspace_id="ws-1")
    names = sorted(e["name"] for e in out["entries"])
    assert names == ["a.txt", "sub"]
    types = {e["name"]: e["type"] for e in out["entries"]}
    assert types == {"a.txt": "file", "sub": "dir"}


@pytest.mark.asyncio
async def test_list_directory_filters_denied_globs(
    monkeypatch: pytest.MonkeyPatch, workspace: LocalWorkspace
) -> None:
    """Denied globs hide entries from listing."""
    from allhands.api import local_files_executors as mod

    root = Path(workspace.root_path)
    (root / "kept.txt").write_text("x")
    (root / ".env").write_text("secret")

    ws = workspace.model_copy(update={"denied_globs": [".env"]})
    repo = _InMemRepo([ws])
    monkeypatch.setattr(mod, "SqlLocalWorkspaceRepo", lambda _s: repo)
    bundle = mod.build_local_files_executors(_StubMaker())
    out = await bundle["allhands.local.list_directory"](workspace_id="ws-1")
    names = [e["name"] for e in out["entries"]]
    assert "kept.txt" in names
    assert ".env" not in names


@pytest.mark.asyncio
async def test_list_directory_dotdot_rejected(
    executors: dict[str, Any], workspace: LocalWorkspace
) -> None:
    out = await executors["allhands.local.list_directory"](workspace_id="ws-1", path="../../etc")
    assert "error" in out


# ---- glob ----


@pytest.mark.asyncio
async def test_glob_recursive(executors: dict[str, Any], workspace: LocalWorkspace) -> None:
    root = Path(workspace.root_path)
    (root / "a").mkdir()
    (root / "a" / "x.py").write_text("")
    (root / "a" / "y.txt").write_text("")
    (root / "z.py").write_text("")
    out = await executors["allhands.local.glob"](workspace_id="ws-1", pattern="**/*.py")
    paths = [Path(p).name for p in out["paths"]]
    assert sorted(paths) == ["x.py", "z.py"]
    assert out["count"] == 2


@pytest.mark.asyncio
async def test_glob_orders_by_mtime_desc(
    executors: dict[str, Any], workspace: LocalWorkspace
) -> None:
    root = Path(workspace.root_path)
    older = root / "old.py"
    newer = root / "new.py"
    older.write_text("")
    time.sleep(0.02)  # noqa: ASYNC251  # mtime resolution test · sync sleep is correct here
    newer.write_text("")
    out = await executors["allhands.local.glob"](workspace_id="ws-1", pattern="*.py")
    assert out["paths"][0].endswith("new.py")
    assert out["paths"][1].endswith("old.py")


@pytest.mark.asyncio
async def test_glob_empty_match(executors: dict[str, Any], workspace: LocalWorkspace) -> None:
    out = await executors["allhands.local.glob"](workspace_id="ws-1", pattern="**/*.rb")
    assert out["count"] == 0
    assert out["paths"] == []


@pytest.mark.asyncio
async def test_glob_skips_default_denied(
    executors: dict[str, Any], workspace: LocalWorkspace
) -> None:
    root = Path(workspace.root_path)
    (root / ".git" / "objects").mkdir(parents=True)
    (root / ".git" / "objects" / "deadbeef").write_text("blob")
    (root / "real.py").write_text("")
    out = await executors["allhands.local.glob"](workspace_id="ws-1", pattern="**/*")
    paths = [Path(p).name for p in out["paths"]]
    assert "real.py" in paths
    assert "deadbeef" not in paths


# ---- workspace auto-pick ----


@pytest.mark.asyncio
async def test_single_workspace_auto_picked(
    executors: dict[str, Any], workspace: LocalWorkspace
) -> None:
    f = Path(workspace.root_path) / "a.txt"
    f.write_text("hi")
    out = await executors["allhands.local.read_file"](path="a.txt")
    assert "error" not in out
    assert out["lines_returned"] == 1


@pytest.mark.asyncio
async def test_multiple_workspaces_require_explicit_id(
    monkeypatch: pytest.MonkeyPatch, tmp_path_factory: pytest.TempPathFactory
) -> None:
    from datetime import UTC, datetime

    from allhands.api import local_files_executors as mod

    now = datetime.now(UTC)
    a = LocalWorkspace(
        id="a",
        name="a",
        root_path=str(tmp_path_factory.mktemp("a").resolve()),
        read_only=False,
        denied_globs=[],
        created_at=now,
        updated_at=now,
    )
    b = a.model_copy(
        update={"id": "b", "name": "b", "root_path": str(tmp_path_factory.mktemp("b").resolve())}
    )
    repo = _InMemRepo([a, b])
    monkeypatch.setattr(mod, "SqlLocalWorkspaceRepo", lambda _s: repo)
    bundle = mod.build_local_files_executors(_StubMaker())
    out = await bundle["allhands.local.list_directory"]()
    assert "error" in out
    assert "multiple" in out["error"]
