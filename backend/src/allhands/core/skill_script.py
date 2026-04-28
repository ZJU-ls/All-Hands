"""Skill script execution domain model · L4 core · pydantic only.

A Skill ships **knowledge** (SKILL.md body + references/) and increasingly
also **executable capability** (scripts/*.py · *.js · *.sh).

Knowledge has been first-class since ADR 0015 (read_skill_file).
This module models the **executable** half — what it means to invoke a
script bundled in a skill, independent of HOW it's executed.

Layering (ADR 0011 § 7):
- This file lives in core/ — only pydantic + stdlib · no subprocess · no Path
  resolution · no I/O. The execution layer (`execution/script_runner.py`)
  consumes these models.
- Sandbox / safety / interpreter routing is the runner's job.
- Tool-layer wrapper (`execution/tools/meta/skill_scripts.py`) adapts these
  to the LLM tool protocol.

Reference: SKILL-SCRIPTS.html design (2026-04-27) · 4-phase plan Phase A.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

# ─────────────────────────────────────────────────────────────────────────────
# Constants — keep here so the runner + tool wrapper agree.
# ─────────────────────────────────────────────────────────────────────────────

DEFAULT_TIMEOUT_SECONDS = 30
MAX_TIMEOUT_SECONDS = 120
MAX_STDIN_BYTES = 64 * 1024
MAX_STDOUT_TAIL_BYTES = 1 * 1024 * 1024
SCRIPT_DIR_PREFIX = "scripts/"  # invocation.script_path must start with this


class ScriptInterpreter(StrEnum):
    """The exec runtime selected for a skill script.

    `auto` is a sentinel meaning "decide from file extension at run time".
    Concrete values pin it explicitly so tests can be deterministic.
    """

    AUTO = "auto"
    PYTHON = "python"
    NODE = "node"
    BASH = "bash"


# Map (file extension → concrete interpreter). The runner consults this
# when invocation.interpreter is AUTO.
EXTENSION_INTERPRETER: dict[str, ScriptInterpreter] = {
    ".py": ScriptInterpreter.PYTHON,
    ".js": ScriptInterpreter.NODE,
    ".mjs": ScriptInterpreter.NODE,
    ".sh": ScriptInterpreter.BASH,
    ".bash": ScriptInterpreter.BASH,
}


KillReason = Literal["timeout", "oom", "user"]


class ScriptInvocation(BaseModel):
    """A single skill-script call · the contract between LLM and runner.

    Validation is intentionally surface-level here; deep checks (path inside
    skill dir · skill is activated · interpreter binary exists) belong to the
    executor, where context (registry · runtime · environment) is available.

    Why pydantic-validate at this layer: the tool layer accepts JSON from the
    LLM, coerces via `coerce_and_validate(tool, kwargs)` (ADR 0021) which
    instantiates this model. Each violation becomes a structured ToolArgError
    envelope the LLM can self-correct against.
    """

    skill_id: str = Field(
        ..., min_length=1, description="An activated skill id (resolve_skill first)."
    )
    script: str = Field(
        ...,
        min_length=len(SCRIPT_DIR_PREFIX) + 1,
        description=(
            "Relative path under the skill dir · MUST start with 'scripts/'. "
            "Example: 'scripts/extract.py'."
        ),
    )
    args: list[str] = Field(default_factory=list, max_length=128)
    stdin: str | None = Field(
        default=None,
        description=f"Optional stdin payload · ≤ {MAX_STDIN_BYTES} bytes UTF-8.",
    )
    timeout_seconds: int = Field(
        default=DEFAULT_TIMEOUT_SECONDS,
        ge=1,
        le=MAX_TIMEOUT_SECONDS,
        description=f"Wall-clock kill budget · default {DEFAULT_TIMEOUT_SECONDS}s · max {MAX_TIMEOUT_SECONDS}s.",
    )
    interpreter: ScriptInterpreter = Field(
        default=ScriptInterpreter.AUTO,
        description="Pin a runtime · 'auto' decides from file extension.",
    )

    model_config = {"frozen": True}

    def stdin_bytes(self) -> bytes | None:
        if self.stdin is None:
            return None
        encoded = self.stdin.encode("utf-8")
        if len(encoded) > MAX_STDIN_BYTES:
            raise ValueError(
                f"stdin exceeds {MAX_STDIN_BYTES} bytes ({len(encoded)} given). "
                "Write large input to a file in scripts/ instead."
            )
        return encoded

    def resolved_interpreter(self) -> ScriptInterpreter:
        """Decide the concrete interpreter · raises if AUTO + unknown extension."""
        if self.interpreter is not ScriptInterpreter.AUTO:
            return self.interpreter
        # find the dotted extension
        idx = self.script.rfind(".")
        if idx < 0:
            raise ValueError(
                f"script {self.script!r} has no extension and interpreter is 'auto'. "
                f"Pin one of: {[i.value for i in ScriptInterpreter if i is not ScriptInterpreter.AUTO]}"
            )
        ext = self.script[idx:].lower()
        if ext not in EXTENSION_INTERPRETER:
            supported = sorted(EXTENSION_INTERPRETER)
            raise ValueError(
                f"unknown script extension {ext!r} · supported: {supported}. "
                f"Pin interpreter explicitly to override."
            )
        return EXTENSION_INTERPRETER[ext]


class ScriptResult(BaseModel):
    """The structured outcome of one skill-script execution.

    Returned (jsonified) from the tool to the LLM. All bytes-bound fields are
    truncated by the runner; clients that need full output read a spool file
    via `read_skill_file` (path supplied in `stdout_spool_path`).
    """

    exit_code: int
    stdout: str = ""
    stderr: str = ""
    duration_ms: int = Field(ge=0)
    interpreter_used: ScriptInterpreter
    killed: KillReason | None = None
    truncated_stdout: bool = False
    truncated_stderr: bool = False
    stdout_spool_path: str | None = Field(
        default=None,
        description=(
            "Relative path under the skill dir's run-logs · agent can read with "
            "read_skill_file when full output is needed."
        ),
    )

    model_config = {"frozen": True}


__all__ = [
    "DEFAULT_TIMEOUT_SECONDS",
    "EXTENSION_INTERPRETER",
    "MAX_STDIN_BYTES",
    "MAX_STDOUT_TAIL_BYTES",
    "MAX_TIMEOUT_SECONDS",
    "SCRIPT_DIR_PREFIX",
    "KillReason",
    "ScriptInterpreter",
    "ScriptInvocation",
    "ScriptResult",
]
