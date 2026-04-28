"""run_skill_script — execute a script bundled in an activated skill.

Sister tool to `read_skill_file` (ADR 0015). Same activation requirement
(skill must be in `runtime.resolved_skills`), same path-sandbox
(`scripts/...` only · no escapes), but scope=IRREVERSIBLE so it goes through
the Confirmation Gate (ADR 0019 · DeferredSignal).

Tool description follows ADR 0021 (self-explaining tools): no "MUST" /
"do NOT" imperatives — pure declarative contract. Errors come back as
structured envelopes the LLM can self-correct against.

Reference:
- product/research/sandbox/SKILL-SCRIPTS.html § 3 design
- ref-src-claude/V05 § 2.3 · skill-bundled scripts
- ADR 0019 deferred capabilities
- ADR 0021 self-explanation
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from allhands.core import CostHint, Tool, ToolKind, ToolScope
from allhands.core.skill_script import (
    DEFAULT_TIMEOUT_SECONDS,
    MAX_STDIN_BYTES,
    MAX_TIMEOUT_SECONDS,
    SCRIPT_DIR_PREFIX,
    ScriptInterpreter,
    ScriptInvocation,
)
from allhands.execution.script_runner import RunnerError, ScriptRunner
from allhands.execution.skills import SkillRegistry, SkillRuntime

# ─────────────────────────────────────────────────────────────────────────────
# Tool stub — registered at boot; bound to a real executor per AgentRunner.
# ─────────────────────────────────────────────────────────────────────────────

RUN_SKILL_SCRIPT_TOOL_ID = "allhands.meta.run_skill_script"

RUN_SKILL_SCRIPT_TOOL = Tool(
    id=RUN_SKILL_SCRIPT_TOOL_ID,
    kind=ToolKind.META,
    name="run_skill_script",
    description=(
        "Execute a script bundled in an activated skill's scripts/ directory. "
        "Use AFTER calling resolve_skill on the same skill_id. The script's "
        "cwd is the skill root; stdout and stderr are captured (tail-truncated "
        "at 1 MB); exit code is returned. Python scripts run via the allhands "
        f"venv; default timeout {DEFAULT_TIMEOUT_SECONDS}s, max "
        f"{MAX_TIMEOUT_SECONDS}s. Pass arguments via the 'args' array. "
        "Optional 'stdin' field accepts a UTF-8 payload up to "
        f"{MAX_STDIN_BYTES // 1024} KB. Returns "
        "{exit_code, stdout, stderr, duration_ms, interpreter_used, killed?}."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "skill_id": {
                "type": "string",
                "description": (
                    "Skill id that has already been activated by resolve_skill in "
                    "this conversation."
                ),
            },
            "script": {
                "type": "string",
                "description": (
                    f"Path under {SCRIPT_DIR_PREFIX!r} relative to the skill root "
                    "(e.g. 'scripts/extract.py')."
                ),
            },
            "args": {
                "type": "array",
                "items": {"type": "string"},
                "default": [],
                "description": "Arguments appended to the interpreter command.",
            },
            "stdin": {
                "type": "string",
                "description": f"Optional stdin · ≤ {MAX_STDIN_BYTES // 1024} KB UTF-8.",
            },
            "timeout_seconds": {
                "type": "integer",
                "minimum": 1,
                "maximum": MAX_TIMEOUT_SECONDS,
                "default": DEFAULT_TIMEOUT_SECONDS,
                "description": "Wall-clock kill budget.",
            },
            "interpreter": {
                "type": "string",
                "enum": [i.value for i in ScriptInterpreter],
                "default": ScriptInterpreter.AUTO.value,
                "description": (
                    "'auto' (decide from extension), or pin one of "
                    f"{[i.value for i in ScriptInterpreter if i is not ScriptInterpreter.AUTO]}."
                ),
            },
        },
        "required": ["skill_id", "script"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "exit_code": {"type": "integer"},
            "stdout": {"type": "string"},
            "stderr": {"type": "string"},
            "duration_ms": {"type": "integer"},
            "interpreter_used": {"type": "string"},
            "killed": {"type": ["string", "null"]},
            "truncated_stdout": {"type": "boolean"},
            "truncated_stderr": {"type": "boolean"},
            "stdout_spool_path": {"type": ["string", "null"]},
            "error": {"type": "string"},
            "field": {"type": "string"},
            "expected": {"type": "string"},
            "received": {"type": "string"},
            "hint": {"type": "string"},
        },
    },
    scope=ToolScope.IRREVERSIBLE,
    requires_confirmation=True,
    cost_hint=CostHint(relative="medium"),
)


# ─────────────────────────────────────────────────────────────────────────────
# Executor factory — bound per AgentRunner with this turn's runtime + registry.
# ─────────────────────────────────────────────────────────────────────────────


RunSkillScriptExecutor = Callable[..., Awaitable[dict[str, Any]]]


def make_run_skill_script_executor(
    *,
    runtime: SkillRuntime,
    skill_registry: SkillRegistry,
    runner: ScriptRunner,
) -> RunSkillScriptExecutor:
    """Build the executor closure · captures dependencies, returns an async fn.

    The closure adapts from the LLM's JSON kwargs to ScriptInvocation, runs the
    invocation, and converts the ScriptResult / RunnerError to a dict the tool
    pipeline can ship as a ToolMessage payload.

    All envelope shapes match ADR 0021: errors return
    `{error, field?, expected?, received?, hint?}`; success returns the
    ScriptResult fields directly.
    """

    async def _execute(**kwargs: Any) -> dict[str, Any]:
        # 1. Activation check — same gate as read_skill_file
        skill_id = kwargs.get("skill_id")
        if not isinstance(skill_id, str) or not skill_id:
            return {
                "error": "skill_id is required and must be a non-empty string",
                "field": "skill_id",
                "expected": "non-empty string",
                "received": repr(skill_id),
            }
        if skill_id not in runtime.resolved_skills:
            return {
                "error": f"skill {skill_id!r} not activated · call resolve_skill first",
                "field": "skill_id",
                "expected": "an id present in runtime.resolved_skills",
                "received": skill_id,
                "hint": (
                    "Invoke allhands.meta.resolve_skill with this skill_id, then "
                    "retry run_skill_script."
                ),
            }

        # 2. Skill must have an on-disk install path
        skill = skill_registry.get_full(skill_id)
        if skill is None or not skill.path:
            return {
                "error": f"skill {skill_id!r} has no install path on disk",
                "field": "skill_id",
                "expected": "a skill with a path attribute",
                "received": skill_id,
                "hint": "This is usually a registry/seed bug; report it.",
            }

        # 3. Build the invocation (pydantic does input validation)
        try:
            invocation = ScriptInvocation(
                skill_id=skill_id,
                script=str(kwargs.get("script", "")),
                args=list(kwargs.get("args", []) or []),
                stdin=kwargs.get("stdin"),
                timeout_seconds=int(kwargs.get("timeout_seconds", DEFAULT_TIMEOUT_SECONDS)),
                interpreter=ScriptInterpreter(
                    kwargs.get("interpreter", ScriptInterpreter.AUTO.value)
                ),
            )
        except ValidationError as exc:
            err = exc.errors()[0]
            return {
                "error": err.get("msg", "invalid invocation"),
                "field": ".".join(str(x) for x in err.get("loc", [])),
                "expected": err.get("type", "valid value"),
                "received": repr(err.get("input")),
            }
        except (ValueError, TypeError) as exc:
            return {"error": str(exc), "field": "interpreter"}

        # 4. Run via the bound ScriptRunner
        skill_dir = Path(skill.path)
        try:
            result = await runner.run(invocation, skill_dir=skill_dir)
        except RunnerError as exc:
            return exc.to_dict()
        except Exception as exc:
            # Truly unexpected — keep agent informed without leaking traceback.
            return {
                "error": f"runner crashed: {exc.__class__.__name__}",
                "hint": "Retry once; if it persists, report a bug.",
            }

        # 5. Serialize ScriptResult → dict (drop None for token economy)
        return result.model_dump(exclude_none=True)

    return _execute


__all__ = [
    "RUN_SKILL_SCRIPT_TOOL",
    "RUN_SKILL_SCRIPT_TOOL_ID",
    "RunSkillScriptExecutor",
    "make_run_skill_script_executor",
]
