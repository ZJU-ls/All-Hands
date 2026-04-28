"""SubprocessScriptRunner end-to-end (uses real subprocess · fast scripts only).

Covers the runner's safety contract:
- Path sandbox (escapes/missing/wrong-prefix → RunnerError)
- Interpreter resolution & explicit override
- Real Python subprocess: stdout / stderr / exit code / args / stdin / env vars
- Timeout: kills hung script and returns killed='timeout'
- Truncation: large stdout is tail-capped
- env allowlist: secrets in os.environ are NOT inherited
- ALLHANDS_SKILL_DIR is exported into the script

Each test writes a tiny .py to a tmp_path skill dir and runs it.
No fakes here — these are integration-grade for the runner itself.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from allhands.core.skill_script import (
    MAX_STDOUT_TAIL_BYTES,
    ScriptInterpreter,
    ScriptInvocation,
)
from allhands.execution.script_runner import (
    InterpreterPaths,
    RunnerError,
    SubprocessScriptRunner,
    safe_resolve_script,
)


@pytest.fixture
def skill_dir(tmp_path: Path) -> Path:
    """A tmp dir with a scripts/ subfolder · ready to host .py fixtures."""
    (tmp_path / "scripts").mkdir()
    return tmp_path


def _write_py(skill_dir: Path, name: str, body: str) -> str:
    """Write a script under scripts/<name> · return the relative path."""
    p = skill_dir / "scripts" / name
    p.write_text(body, encoding="utf-8")
    return f"scripts/{name}"


# ──────────────────────────────────────────────────────────────────────────
# safe_resolve_script: path sandbox
# ──────────────────────────────────────────────────────────────────────────


def test_resolve_rejects_non_scripts_prefix(skill_dir: Path) -> None:
    with pytest.raises(RunnerError, match="must live under 'scripts/'"):
        safe_resolve_script(skill_dir, "templates/x.py")


def test_resolve_rejects_absolute_path(skill_dir: Path) -> None:
    with pytest.raises(RunnerError):
        safe_resolve_script(skill_dir, "/scripts/x.py")


def test_resolve_rejects_traversal(skill_dir: Path) -> None:
    outside = skill_dir.parent / "secret.py"
    outside.write_text("print('leaked')")
    with pytest.raises(RunnerError, match="escapes"):
        safe_resolve_script(skill_dir, "scripts/../../secret.py")


def test_resolve_rejects_missing_file(skill_dir: Path) -> None:
    with pytest.raises(RunnerError, match="not found"):
        safe_resolve_script(skill_dir, "scripts/nope.py")


def test_resolve_rejects_directory(skill_dir: Path) -> None:
    (skill_dir / "scripts" / "sub").mkdir()
    with pytest.raises(RunnerError, match="not a file"):
        safe_resolve_script(skill_dir, "scripts/sub")


def test_resolve_ok(skill_dir: Path) -> None:
    rel = _write_py(skill_dir, "ok.py", "print('hi')")
    resolved = safe_resolve_script(skill_dir, rel)
    assert resolved.name == "ok.py"
    assert resolved.is_file()


# ──────────────────────────────────────────────────────────────────────────
# Real subprocess runs · python only (always available in test env)
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_runs_python_and_returns_stdout(skill_dir: Path) -> None:
    rel = _write_py(skill_dir, "hello.py", "print('hello world')")
    runner = SubprocessScriptRunner()
    result = await runner.run(ScriptInvocation(skill_id="x", script=rel), skill_dir=skill_dir)
    assert result.exit_code == 0
    assert result.stdout.strip() == "hello world"
    assert result.stderr == ""
    assert result.interpreter_used is ScriptInterpreter.PYTHON
    assert result.killed is None
    assert result.duration_ms > 0


@pytest.mark.asyncio
async def test_passes_args_via_argv(skill_dir: Path) -> None:
    rel = _write_py(
        skill_dir,
        "argv.py",
        "import sys; print(' '.join(sys.argv[1:]))",
    )
    runner = SubprocessScriptRunner()
    result = await runner.run(
        ScriptInvocation(skill_id="x", script=rel, args=["foo", "bar baz"]),
        skill_dir=skill_dir,
    )
    assert result.exit_code == 0
    assert result.stdout.strip() == "foo bar baz"


@pytest.mark.asyncio
async def test_passes_stdin(skill_dir: Path) -> None:
    rel = _write_py(
        skill_dir,
        "stdin.py",
        "import sys; print(sys.stdin.read().upper())",
    )
    runner = SubprocessScriptRunner()
    result = await runner.run(
        ScriptInvocation(skill_id="x", script=rel, stdin="hello"),
        skill_dir=skill_dir,
    )
    assert result.exit_code == 0
    assert "HELLO" in result.stdout


@pytest.mark.asyncio
async def test_propagates_nonzero_exit(skill_dir: Path) -> None:
    rel = _write_py(skill_dir, "fail.py", "import sys; sys.exit(3)")
    runner = SubprocessScriptRunner()
    result = await runner.run(ScriptInvocation(skill_id="x", script=rel), skill_dir=skill_dir)
    assert result.exit_code == 3
    assert result.killed is None


@pytest.mark.asyncio
async def test_captures_stderr(skill_dir: Path) -> None:
    rel = _write_py(
        skill_dir,
        "stderr.py",
        "import sys; sys.stderr.write('boom\\n'); sys.exit(1)",
    )
    runner = SubprocessScriptRunner()
    result = await runner.run(ScriptInvocation(skill_id="x", script=rel), skill_dir=skill_dir)
    assert result.exit_code == 1
    assert "boom" in result.stderr


# ──────────────────────────────────────────────────────────────────────────
# Timeout / truncation / env safety
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_timeout_kills_long_running(skill_dir: Path) -> None:
    rel = _write_py(skill_dir, "spin.py", "import time; time.sleep(60)")
    runner = SubprocessScriptRunner()
    result = await runner.run(
        ScriptInvocation(skill_id="x", script=rel, timeout_seconds=1),
        skill_dir=skill_dir,
    )
    assert result.killed == "timeout"
    # exit code may be -SIGKILL or non-zero · don't pin a specific value


@pytest.mark.asyncio
async def test_truncates_huge_stdout(skill_dir: Path) -> None:
    # Print 2 MB · expect tail truncation
    rel = _write_py(
        skill_dir,
        "flood.py",
        f"import sys; sys.stdout.write('x' * {MAX_STDOUT_TAIL_BYTES * 2})",
    )
    runner = SubprocessScriptRunner()
    result = await runner.run(
        ScriptInvocation(skill_id="x", script=rel, timeout_seconds=10),
        skill_dir=skill_dir,
    )
    assert result.exit_code == 0
    assert result.truncated_stdout is True
    assert len(result.stdout.encode("utf-8")) <= MAX_STDOUT_TAIL_BYTES


@pytest.mark.asyncio
async def test_env_allowlist_blocks_secrets(
    skill_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Plant a secret in our own env · script should NOT see it
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "tipoftheicebergsecret")
    rel = _write_py(
        skill_dir,
        "leak.py",
        "import os; print(os.environ.get('AWS_SECRET_ACCESS_KEY', 'NOT_SET'))",
    )
    runner = SubprocessScriptRunner()
    result = await runner.run(ScriptInvocation(skill_id="x", script=rel), skill_dir=skill_dir)
    assert "tipoftheicebergsecret" not in result.stdout
    assert "NOT_SET" in result.stdout


@pytest.mark.asyncio
async def test_exposes_allhands_skill_dir(skill_dir: Path) -> None:
    rel = _write_py(
        skill_dir,
        "envcheck.py",
        "import os; print(os.environ['ALLHANDS_SKILL_DIR'])",
    )
    runner = SubprocessScriptRunner()
    result = await runner.run(ScriptInvocation(skill_id="x", script=rel), skill_dir=skill_dir)
    assert result.exit_code == 0
    # Resolved path · so works even if skill_dir is a symlink
    assert os.path.realpath(skill_dir) in result.stdout


@pytest.mark.asyncio
async def test_cwd_is_skill_root(skill_dir: Path) -> None:
    """Sibling helper modules in skill root must be importable."""
    (skill_dir / "helper.py").write_text("def greet(): return 'helped'\n")
    rel = _write_py(
        skill_dir,
        "uses_helper.py",
        "import sys; sys.path.insert(0, '.'); from helper import greet; print(greet())",
    )
    runner = SubprocessScriptRunner()
    result = await runner.run(ScriptInvocation(skill_id="x", script=rel), skill_dir=skill_dir)
    assert result.exit_code == 0
    assert "helped" in result.stdout


# ──────────────────────────────────────────────────────────────────────────
# Interpreter override · explicit pin
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_explicit_python_interpreter(skill_dir: Path) -> None:
    rel = _write_py(skill_dir, "boring.txt", "print('not really python')")
    # File is .txt · auto would fail · pin python
    runner = SubprocessScriptRunner()
    result = await runner.run(
        ScriptInvocation(skill_id="x", script=rel, interpreter=ScriptInterpreter.PYTHON),
        skill_dir=skill_dir,
    )
    assert result.exit_code == 0
    assert "not really python" in result.stdout


# ──────────────────────────────────────────────────────────────────────────
# Interpreter discovery
# ──────────────────────────────────────────────────────────────────────────


def test_discover_finds_python() -> None:
    paths = InterpreterPaths.discover()
    assert paths.python is not None  # always exists in pytest env


def test_discover_python_override() -> None:
    paths = InterpreterPaths.discover(python_override="/custom/python")
    assert paths.python == "/custom/python"
