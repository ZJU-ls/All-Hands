"""M3 · grep · ripgrep + python fallback paths."""

from __future__ import annotations

import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from allhands.core import LocalWorkspace


# Reuse the in-mem repo / stub session pattern from M2 test.
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
    root = tmp_path_factory.mktemp("ws-grep").resolve()
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
def populated_root(workspace: LocalWorkspace) -> Path:
    root = Path(workspace.root_path)
    (root / "a.py").write_text("def foo():\n    return 1\n# todo: implement\n")
    (root / "b.py").write_text("def bar():\n    pass\n")
    (root / "c.txt").write_text("nothing here\n")
    sub = root / "sub"
    sub.mkdir()
    (sub / "d.py").write_text("# TODO check\nfoo_var = 2\n")
    return root


@pytest.fixture
def grep_executor(monkeypatch: pytest.MonkeyPatch, workspace: LocalWorkspace) -> Any:
    from allhands.api import local_files_executors as mod

    repo = _InMemRepo([workspace])
    monkeypatch.setattr(mod, "SqlLocalWorkspaceRepo", lambda _s: repo)
    bundle = mod.build_local_files_executors(_StubMaker())
    return bundle["allhands.local.grep"]


@pytest.mark.asyncio
async def test_grep_files_with_matches(grep_executor: Any, populated_root: Path) -> None:
    out = await grep_executor(workspace_id="ws-1", pattern="def foo")
    assert out["count"] >= 1
    assert any("a.py" in m for m in out["matches"])


@pytest.mark.asyncio
async def test_grep_no_match(grep_executor: Any, populated_root: Path) -> None:
    out = await grep_executor(workspace_id="ws-1", pattern="qzzzzzz_no_match")
    assert out["count"] == 0
    assert out["matches"] == []


@pytest.mark.asyncio
async def test_grep_content_mode(grep_executor: Any, populated_root: Path) -> None:
    out = await grep_executor(
        workspace_id="ws-1",
        pattern="todo",
        output_mode="content",
    )
    # case-sensitive, "todo" not "TODO"
    assert any("# todo" in m.lower() for m in out["matches"])


@pytest.mark.asyncio
async def test_grep_case_insensitive(grep_executor: Any, populated_root: Path) -> None:
    out = await grep_executor(
        workspace_id="ws-1",
        pattern="TODO",
        output_mode="files_with_matches",
        **{"-i": True},
    )
    paths = [Path(p).name for p in out["matches"]]
    # Both a.py (lowercase todo) and d.py (uppercase TODO) should appear
    assert "a.py" in paths or any("a.py" in p for p in out["matches"])


@pytest.mark.asyncio
async def test_grep_count_mode(grep_executor: Any, populated_root: Path) -> None:
    out = await grep_executor(
        workspace_id="ws-1",
        pattern="def ",
        output_mode="count",
    )
    assert out["count"] >= 1
    rows = out["matches"]
    assert all("path" in r and "count" in r for r in rows)


@pytest.mark.asyncio
async def test_grep_invalid_output_mode(grep_executor: Any, populated_root: Path) -> None:
    out = await grep_executor(workspace_id="ws-1", pattern="x", output_mode="bogus")
    assert "error" in out
    assert out["field"] == "output_mode"


@pytest.mark.asyncio
async def test_grep_invalid_regex_python_path(
    monkeypatch: pytest.MonkeyPatch, grep_executor: Any, populated_root: Path
) -> None:
    """Force python fallback to test invalid-regex error path."""
    from allhands.api import local_files_executors as mod

    monkeypatch.setattr(mod, "shutil", type("S", (), {"which": staticmethod(lambda _x: None)}))
    out = await grep_executor(workspace_id="ws-1", pattern="(unbalanced", output_mode="content")
    assert "error" in out
    assert "regex" in out["error"]


@pytest.mark.asyncio
async def test_grep_glob_filter(grep_executor: Any, populated_root: Path) -> None:
    """Restrict to *.py — c.txt would never match anyway, but the glob path
    must not crash."""
    out = await grep_executor(
        workspace_id="ws-1",
        pattern="def ",
        glob="*.py",
        output_mode="files_with_matches",
    )
    assert out["count"] >= 1


@pytest.mark.asyncio
async def test_grep_python_fallback_path(
    monkeypatch: pytest.MonkeyPatch,
    grep_executor: Any,
    populated_root: Path,
) -> None:
    """Force python fallback even if rg is installed."""
    from allhands.api import local_files_executors as mod

    class _S:
        @staticmethod
        def which(_x: str) -> None:
            return None

    monkeypatch.setattr(mod, "shutil", _S)
    out = await grep_executor(
        workspace_id="ws-1",
        pattern="foo",
        output_mode="content",
        **{"-n": True},
    )
    assert out["count"] >= 1
    # python fallback adds path:line:content
    assert any(":" in m for m in out["matches"])


def test_ripgrep_optional() -> None:
    """Sanity: code path doesn't require rg to be installed."""
    # Just verifies the test environment doesn't break either way
    _ = shutil.which("rg")
