"""Skill script runtime adapter · L5 execution.

Splits the *what to run* (`core.skill_script.ScriptInvocation`) from the
*how to run it* (subprocess vs. Fake vs. future containerized vs. remote).

Why an ABC: the tool layer needs to be wired against an interface so tests
can substitute a `FakeScriptRunner` without spawning processes — the real
`SubprocessScriptRunner` then becomes one bind among many (containerised
runner / remote runner are easy follow-ups · same Protocol).

Sandbox / safety responsibilities live HERE, not in the tool layer:
- `cwd` is locked to the skill install dir at call time
- `env` is a strict allowlist (never inherit user shell env — token leak risk)
- stdout/stderr capped at MAX_STDOUT_TAIL_BYTES; tail policy
- timeout via asyncio · graceful kill chain
- Python interpreter resolves to `~/.allhands/venv/bin/python` if present,
  else `sys.executable` (skill-dedicated venv arrives in Phase B)

This module does NOT decide whether the agent is allowed to invoke a script.
That is the tool layer's job (Confirmation Gate · scope=IRREVERSIBLE) plus
the runner's `_safe_resolve` path check.

Reference:
- ADR 0021 · self-explaining tools — runner returns ScriptResult / raises
  RunnerError, never bare subprocess errors
- SKILL-SCRIPTS.html § 3.2 · safety boundaries
"""

from __future__ import annotations

import asyncio
import os
import resource  # POSIX only · acceptable for v0 (we ship dev mode for unix-likes)
import shutil
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, runtime_checkable

from allhands.core.skill_script import (
    EXTENSION_INTERPRETER,
    MAX_STDOUT_TAIL_BYTES,
    SCRIPT_DIR_PREFIX,
    KillReason,
    ScriptInterpreter,
    ScriptInvocation,
    ScriptResult,
)


class RunnerError(Exception):
    """Surfaceable error from the runner — caught by the tool layer and turned
    into a ToolArgError envelope per ADR 0021."""

    def __init__(
        self,
        message: str,
        *,
        field: str | None = None,
        expected: str | None = None,
        received: str | None = None,
        hint: str | None = None,
    ) -> None:
        super().__init__(message)
        self.field = field
        self.expected = expected
        self.received = received
        self.hint = hint

    def to_dict(self) -> dict[str, str]:
        d: dict[str, str] = {"error": str(self)}
        if self.field is not None:
            d["field"] = self.field
        if self.expected is not None:
            d["expected"] = self.expected
        if self.received is not None:
            d["received"] = self.received
        if self.hint is not None:
            d["hint"] = self.hint
        return d


@runtime_checkable
class ScriptRunner(Protocol):
    """Anything that can take an invocation + skill dir and produce a result."""

    async def run(
        self,
        invocation: ScriptInvocation,
        *,
        skill_dir: Path,
    ) -> ScriptResult: ...


# ─────────────────────────────────────────────────────────────────────────────
# Path validation — shared with the tool layer's safety check
# ─────────────────────────────────────────────────────────────────────────────


def _resolve_skill_dir(skill_dir: Path) -> str:
    """Sync helper to resolve a skill dir to absolute path · ASYNC240-safe to wrap."""
    return str(skill_dir.resolve())


def safe_resolve_script(skill_dir: Path, script_path: str) -> Path:
    """Resolve `script_path` under `skill_dir` · reject escapes/symlinks/wrong dir.

    Mirrors `skill_files._safe_resolve` but adds the SCRIPT_DIR_PREFIX requirement.
    """
    if not script_path.startswith(SCRIPT_DIR_PREFIX):
        raise RunnerError(
            f"script must live under '{SCRIPT_DIR_PREFIX}' — got {script_path!r}",
            field="script",
            expected=f"path starting with '{SCRIPT_DIR_PREFIX}'",
            received=script_path,
            hint=f"Place your script in '{SCRIPT_DIR_PREFIX}<name>.py' inside the skill.",
        )
    if Path(script_path).is_absolute():
        raise RunnerError(
            "script must be a relative path",
            field="script",
            expected="relative path",
            received=script_path,
        )
    target = (skill_dir / script_path).resolve()
    root = skill_dir.resolve()
    if not target.is_relative_to(root):
        raise RunnerError(
            f"script path escapes skill dir: {script_path!r}",
            field="script",
            expected=f"resolved path under {root}",
            received=str(target),
            hint="Don't use '..' or symlinks pointing outside the skill.",
        )
    if not target.exists():
        raise RunnerError(
            f"script not found: {script_path!r}",
            field="script",
            expected="existing file",
            received=script_path,
            hint=("Use read_skill_file or list the skill dir first to confirm the script exists."),
        )
    if not target.is_file():
        raise RunnerError(
            f"not a file: {script_path!r}",
            field="script",
            expected="regular file",
            received=script_path,
        )
    return target


# ─────────────────────────────────────────────────────────────────────────────
# Interpreter discovery — pluggable, easy to override in tests
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class InterpreterPaths:
    """Resolved abs paths for each interpreter · None means missing on this host."""

    python: str | None
    node: str | None
    bash: str | None

    @classmethod
    def discover(cls, *, python_override: str | None = None) -> InterpreterPaths:
        """Probe PATH + the allhands venv for each interpreter.

        Python preference: `~/.allhands/venv/bin/python` → `sys.executable`.
        Node / bash: PATH lookup via `shutil.which`.
        """
        if python_override is not None:
            py = python_override
        else:
            allhands_venv = Path.home() / ".allhands" / "venv" / "bin" / "python"
            py = str(allhands_venv) if allhands_venv.exists() else sys.executable
        return cls(
            python=py,
            node=shutil.which("node"),
            bash=shutil.which("bash"),
        )

    def resolve(self, interp: ScriptInterpreter) -> str:
        match interp:
            case ScriptInterpreter.PYTHON:
                if self.python is None:
                    raise RunnerError(
                        "python interpreter not found",
                        field="interpreter",
                        expected="python on PATH or in ~/.allhands/venv",
                        hint="Install python or run scripts/setup-local-env.sh",
                    )
                return self.python
            case ScriptInterpreter.NODE:
                if self.node is None:
                    raise RunnerError(
                        "node interpreter not found",
                        field="interpreter",
                        expected="node on PATH",
                        hint="Install Node.js or pin a different interpreter.",
                    )
                return self.node
            case ScriptInterpreter.BASH:
                if self.bash is None:
                    raise RunnerError(
                        "bash interpreter not found",
                        field="interpreter",
                        expected="bash on PATH",
                    )
                return self.bash
            case ScriptInterpreter.AUTO:
                # ScriptInvocation.resolved_interpreter() should have eliminated this.
                raise RunnerError(
                    "ScriptInterpreter.AUTO is a sentinel · resolve before .resolve()",
                    field="interpreter",
                    expected="concrete interpreter",
                    received="auto",
                )


# ─────────────────────────────────────────────────────────────────────────────
# Safe environment — strict allowlist · never leak user shell secrets
# ─────────────────────────────────────────────────────────────────────────────


def _safe_env(skill_dir: Path, *, extra_data_dir: Path | None = None) -> dict[str, str]:
    """Allowlist env vars passed to the script.

    Why so restrictive: scripts are LLM-driven · we cannot trust them to
    behave with $AWS_SECRET_ACCESS_KEY in scope. Skill authors who need
    a secret declare it explicitly (future Phase: `requires_secrets:` in
    SKILL.yaml + UI grant flow).
    """
    base = {k: os.environ[k] for k in ("PATH", "HOME", "LANG", "LC_ALL") if k in os.environ}
    base["ALLHANDS_SKILL_DIR"] = str(skill_dir)
    if extra_data_dir is not None:
        base["ALLHANDS_DATA"] = str(extra_data_dir)
    # Force unbuffered Python output so we get streamed stdout up to timeout
    base["PYTHONUNBUFFERED"] = "1"
    return base


# ─────────────────────────────────────────────────────────────────────────────
# Subprocess implementation — production runner
# ─────────────────────────────────────────────────────────────────────────────


def _set_rlimits() -> None:
    """Soft caps applied via preexec_fn — best-effort sandbox.

    address-space limit (~ 1 GB) keeps a runaway python from eating RAM.
    Linux supports this; macOS partially. Failure to set is non-fatal.
    """
    try:
        # 1 GB virtual address space soft cap
        gb = 1024 * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (gb, gb))
    except (ValueError, OSError):
        pass


def _truncate(buf: bytes, *, cap: int = MAX_STDOUT_TAIL_BYTES) -> tuple[str, bool]:
    """Return (utf-8 tail decoded, was_truncated). UTF-8 errors → replacement."""
    truncated = len(buf) > cap
    if truncated:
        buf = buf[-cap:]
    return buf.decode("utf-8", errors="replace"), truncated


class SubprocessScriptRunner:
    """Production runner · asyncio.subprocess with all the safety bits.

    Stateless · safe to share across requests · cheap to construct.
    """

    def __init__(
        self,
        *,
        interpreters: InterpreterPaths | None = None,
        data_dir: Path | None = None,
    ) -> None:
        self._interps = interpreters or InterpreterPaths.discover()
        self._data_dir = data_dir

    @property
    def interpreters(self) -> InterpreterPaths:
        return self._interps

    async def run(
        self,
        invocation: ScriptInvocation,
        *,
        skill_dir: Path,
    ) -> ScriptResult:
        # 1. Validate path (sync helpers · OK to call from async body)
        target_path = safe_resolve_script(skill_dir, invocation.script)
        cwd_resolved = _resolve_skill_dir(skill_dir)

        # 2. Resolve interpreter
        try:
            interp = invocation.resolved_interpreter()
        except ValueError as exc:
            # The pydantic model raises ValueError; surface as RunnerError so the
            # tool layer's catch-and-envelope path kicks in.
            raise RunnerError(
                str(exc),
                field="interpreter",
                expected="auto-detectable extension or explicit interpreter",
                received=invocation.script,
            ) from exc
        interp_path = self._interps.resolve(interp)

        # 3. Build cmd · env · stdin
        cmd = [interp_path, str(target_path), *invocation.args]
        env = _safe_env(skill_dir, extra_data_dir=self._data_dir)
        stdin_bytes = invocation.stdin_bytes()  # may raise ValueError on too-big

        # 4. Spawn · time · communicate
        started = time.monotonic()
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE
                if stdin_bytes is not None
                else asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd_resolved,
                env=env,
                preexec_fn=_set_rlimits if os.name == "posix" else None,
            )
        except FileNotFoundError as exc:
            # Interpreter binary disappeared between discovery and exec — rare
            # but possible if the venv was wiped mid-session.
            raise RunnerError(
                f"failed to launch interpreter {interp.value!r}: {exc}",
                field="interpreter",
                expected=f"{interp.value} binary at {interp_path}",
                received=str(exc),
                hint="Re-run the env setup script and retry.",
            ) from exc

        killed: KillReason | None = None
        try:
            out_bytes, err_bytes = await asyncio.wait_for(
                proc.communicate(input=stdin_bytes),
                timeout=invocation.timeout_seconds,
            )
        except TimeoutError:
            killed = "timeout"
            proc.kill()
            # Drain whatever was buffered before the kill so the agent sees
            # *some* output (often the cause of the hang).
            out_bytes, err_bytes = await proc.communicate()

        duration_ms = int((time.monotonic() - started) * 1000)

        stdout_str, out_trunc = _truncate(out_bytes)
        stderr_str, err_trunc = _truncate(err_bytes)

        return ScriptResult(
            exit_code=proc.returncode if proc.returncode is not None else -1,
            stdout=stdout_str,
            stderr=stderr_str,
            duration_ms=duration_ms,
            interpreter_used=interp,
            killed=killed,
            truncated_stdout=out_trunc,
            truncated_stderr=err_trunc,
            stdout_spool_path=None,  # Phase C: large-output spool to logs/
        )


# ─────────────────────────────────────────────────────────────────────────────
# Fake — for unit tests · zero side effects
# ─────────────────────────────────────────────────────────────────────────────


class FakeScriptRunner:
    """Unit-test fake · returns canned ScriptResult, records last invocation.

    Usage:
        runner = FakeScriptRunner(result=ScriptResult(exit_code=0, ...))
        out = await runner.run(invocation, skill_dir=Path('/tmp'))
        assert runner.last_invocation == invocation
    """

    def __init__(
        self,
        *,
        result: ScriptResult | None = None,
        raises: RunnerError | None = None,
        validate_path: bool = False,
    ) -> None:
        self._result = result or ScriptResult(
            exit_code=0,
            stdout="fake stdout",
            stderr="",
            duration_ms=1,
            interpreter_used=ScriptInterpreter.PYTHON,
        )
        self._raises = raises
        self._validate_path = validate_path
        self.last_invocation: ScriptInvocation | None = None
        self.last_skill_dir: Path | None = None
        self.call_count = 0

    async def run(
        self,
        invocation: ScriptInvocation,
        *,
        skill_dir: Path,
    ) -> ScriptResult:
        self.last_invocation = invocation
        self.last_skill_dir = skill_dir
        self.call_count += 1
        if self._raises is not None:
            raise self._raises
        if self._validate_path:
            safe_resolve_script(skill_dir, invocation.script)  # may raise
        return self._result


__all__ = [
    "EXTENSION_INTERPRETER",
    "FakeScriptRunner",
    "InterpreterPaths",
    "RunnerError",
    "ScriptRunner",
    "SubprocessScriptRunner",
    "safe_resolve_script",
]
