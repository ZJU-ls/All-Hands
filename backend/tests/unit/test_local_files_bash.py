"""M5 · bash — timeout / cwd / blacklist / output truncation."""

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
    root = tmp_path_factory.mktemp("ws-bash").resolve()
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
def bash_exec(monkeypatch: pytest.MonkeyPatch, workspace: LocalWorkspace) -> Any:
    from allhands.api import local_files_executors as mod

    repo = _InMemRepo([workspace])
    monkeypatch.setattr(mod, "SqlLocalWorkspaceRepo", lambda _s: repo)
    bundle = mod.build_local_files_executors(_StubMaker())
    return bundle["allhands.local.bash"]


@pytest.mark.asyncio
async def test_bash_runs_simple_command(bash_exec: Any, workspace: LocalWorkspace) -> None:
    out = await bash_exec(workspace_id="ws-1", command="echo hello")
    assert out["exit_code"] == 0
    assert "hello" in out["stdout"]


@pytest.mark.asyncio
async def test_bash_cwd_defaults_to_workspace_root(
    bash_exec: Any, workspace: LocalWorkspace
) -> None:
    out = await bash_exec(workspace_id="ws-1", command="pwd")
    assert Path(out["stdout"].strip()).resolve() == Path(workspace.root_path).resolve()


@pytest.mark.asyncio
async def test_bash_explicit_cwd_inside_workspace(
    bash_exec: Any, workspace: LocalWorkspace
) -> None:
    sub = Path(workspace.root_path) / "sub"
    sub.mkdir()
    out = await bash_exec(workspace_id="ws-1", command="pwd", cwd="sub")
    assert Path(out["stdout"].strip()).resolve() == sub.resolve()


@pytest.mark.asyncio
async def test_bash_cwd_outside_rejected(bash_exec: Any, workspace: LocalWorkspace) -> None:
    out = await bash_exec(workspace_id="ws-1", command="pwd", cwd="/etc")
    assert "error" in out


@pytest.mark.asyncio
async def test_bash_nonzero_exit_returns_stderr(bash_exec: Any, workspace: LocalWorkspace) -> None:
    out = await bash_exec(workspace_id="ws-1", command="ls /nonexistent-xyz")
    assert out["exit_code"] != 0
    assert out["stderr"]


@pytest.mark.asyncio
async def test_bash_timeout(bash_exec: Any, workspace: LocalWorkspace) -> None:
    out = await bash_exec(workspace_id="ws-1", command="sleep 5", timeout_ms=300)
    assert "error" in out
    assert "timed out" in out["error"]


@pytest.mark.asyncio
async def test_bash_hard_block_rm_rf_root(bash_exec: Any, workspace: LocalWorkspace) -> None:
    out = await bash_exec(workspace_id="ws-1", command="rm -rf /")
    assert "error" in out
    assert "blocked" in out["error"]


@pytest.mark.asyncio
async def test_bash_hard_block_fork_bomb(bash_exec: Any, workspace: LocalWorkspace) -> None:
    out = await bash_exec(workspace_id="ws-1", command=":(){ :|:& };:")
    assert "error" in out
    assert "blocked" in out["error"]


@pytest.mark.asyncio
async def test_bash_hard_block_dd_disk(bash_exec: Any, workspace: LocalWorkspace) -> None:
    out = await bash_exec(workspace_id="ws-1", command="dd if=/dev/zero of=/dev/sda")
    assert "error" in out
    assert "blocked" in out["error"]


@pytest.mark.asyncio
async def test_bash_normal_rm_passes(bash_exec: Any, workspace: LocalWorkspace) -> None:
    """rm of a workspace file is allowed (not hard-blocked)."""
    f = Path(workspace.root_path) / "junk.txt"
    f.write_text("x")
    out = await bash_exec(workspace_id="ws-1", command="rm junk.txt")
    assert "error" not in out
    assert out["exit_code"] == 0
    assert not f.exists()


@pytest.mark.asyncio
async def test_bash_empty_command_rejected(bash_exec: Any, workspace: LocalWorkspace) -> None:
    out = await bash_exec(workspace_id="ws-1", command="   ")
    assert "error" in out


@pytest.mark.asyncio
async def test_bash_output_truncation(bash_exec: Any, workspace: LocalWorkspace) -> None:
    """Long stdout is truncated head+tail."""
    out = await bash_exec(
        workspace_id="ws-1",
        command="python3 -c 'print(\"x\" * 100000)'",
    )
    assert out["stdout_truncated"] is True
    assert "truncated" in out["stdout"]


@pytest.mark.asyncio
async def test_bash_blocked_in_read_only_workspace(
    monkeypatch: pytest.MonkeyPatch, workspace: LocalWorkspace
) -> None:
    from allhands.api import local_files_executors as mod

    ro = workspace.model_copy(update={"read_only": True})
    repo = _InMemRepo([ro])
    monkeypatch.setattr(mod, "SqlLocalWorkspaceRepo", lambda _s: repo)
    bundle = mod.build_local_files_executors(_StubMaker())
    out = await bundle["allhands.local.bash"](workspace_id="ws-1", command="echo hi")
    assert "error" in out
    assert "read_only" in out["error"]
