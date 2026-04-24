"""read_skill_file — sandboxed reader for active skill install dirs.

ADR 0015 Phase 3. Progressive-loading stage 3: once a skill is activated
(via resolve_skill), the agent can pull references/, templates/, or
scripts/ content on demand through this tool. Read-scope, ≤ 256KB, UTF-8,
path-sandboxed to the skill's install root. No Confirmation Gate.

Ref: ref-src-claude/V05-skills-system.md § 2.3 + Claude Code's per-skill
file access pattern — skill body guides the agent to read specific
references as needed, rather than eagerly inlining everything at
activation time.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from allhands.core import CostHint, Tool, ToolKind, ToolScope
from allhands.execution.skills import SkillRegistry, SkillRuntime

MAX_READ_BYTES = 256 * 1024  # 256KB


class SandboxError(Exception):
    """Path validation failure — not an OS error."""


READ_SKILL_FILE_TOOL = Tool(
    id="allhands.meta.read_skill_file",
    kind=ToolKind.META,
    name="read_skill_file",
    description=(
        "Read a file inside an activated skill's install directory. "
        "Use this AFTER calling resolve_skill — lets you pull the "
        "skill's references/, templates/, or scripts/ content on demand. "
        "Path is RELATIVE to the skill's root (e.g. 'references/guide.md'). "
        "Max 256KB, UTF-8 only. Directory escapes (..) and symlinks are rejected."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "skill_id": {
                "type": "string",
                "description": "Skill id — must already be activated via resolve_skill.",
            },
            "relative_path": {
                "type": "string",
                "description": (
                    "Path relative to the skill root (e.g. 'SKILL.md', 'references/notes.md')."
                ),
            },
        },
        "required": ["skill_id", "relative_path"],
    },
    output_schema={
        "type": "object",
        "properties": {
            "content": {"type": "string"},
            "bytes": {"type": "integer"},
            "path": {"type": "string"},
            "error": {"type": "string"},
        },
    },
    scope=ToolScope.READ,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


def _safe_resolve(install_dir: Path, rel_path: str) -> Path:
    """Resolve `rel_path` under `install_dir`, rejecting any escape.

    Uses `Path.resolve()` on both sides (which follows symlinks) so
    symlinked-out targets are caught by the `is_relative_to` check.
    """
    if Path(rel_path).is_absolute():
        raise SandboxError("relative_path must not be absolute")
    target = (install_dir / rel_path).resolve()
    root = install_dir.resolve()
    if not target.is_relative_to(root):
        raise SandboxError(f"relative_path escapes skill directory: {rel_path}")
    if not target.exists():
        raise FileNotFoundError(str(target))
    if not target.is_file():
        raise SandboxError(f"not a file: {rel_path}")
    return target


ReadSkillFileExecutor = Callable[..., Awaitable[dict[str, Any]]]


def make_read_skill_file_executor(
    *,
    runtime: SkillRuntime,
    skill_registry: SkillRegistry,
) -> ReadSkillFileExecutor:
    """Bind per-AgentRunner: reads are gated on THIS runtime's activations."""

    def _read_sync(skill_id: str, relative_path: str) -> dict[str, Any]:
        if skill_id not in runtime.resolved_skills:
            return {"error": (f"skill {skill_id!r} not activated. Call resolve_skill first.")}
        skill = skill_registry.get_full(skill_id)
        if skill is None or not skill.path:
            return {"error": f"skill {skill_id!r} has no install path on disk"}
        install_dir = Path(skill.path)
        try:
            target = _safe_resolve(install_dir, relative_path)
        except SandboxError as exc:
            return {"error": str(exc)}
        except FileNotFoundError:
            return {"error": f"file not found: {relative_path}"}

        size = target.stat().st_size
        if size > MAX_READ_BYTES:
            return {
                "error": (
                    f"file too large: {size} bytes > {MAX_READ_BYTES} max. "
                    "Split into smaller references or read a specific section."
                )
            }
        try:
            content = target.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return {"error": f"file is not valid UTF-8: {relative_path}"}

        return {
            "content": content,
            "bytes": size,
            "path": str(target.relative_to(install_dir.resolve())),
        }

    async def _execute(skill_id: str, relative_path: str) -> dict[str, Any]:
        # Synchronous filesystem work is isolated in `_read_sync`; this async
        # wrapper exists because the LangGraph tool interface expects a
        # coroutine (ruff ASYNC240 disallows pathlib calls inside async bodies).
        return _read_sync(skill_id, relative_path)

    return _execute
