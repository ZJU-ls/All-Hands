"""resolve_skill — per-conversation dynamic skill activation.

Spec: docs/specs/agent-runtime-contract.md § 5.1 + § 8.3.
Ref: ref-src-claude/V05-skills-system.md § 2.3 · per-command lazy prompt
load (`getPromptForCommand`). Skills are declared, not pre-loaded; the
model itself decides when to pay the context cost.

Scope = READ because the mutation is purely in-memory on the current
AgentRunner's `SkillRuntime`. No DB write, no external side effect.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from allhands.core import Tool, ToolKind, ToolScope
from allhands.execution.skills import SkillRegistry, SkillRuntime
from allhands.execution.skills_body import read_skill_body

RESOLVE_SKILL_TOOL = Tool(
    id="allhands.meta.resolve_skill",
    kind=ToolKind.META,
    name="resolve_skill",
    description=(
        "Activate one of the skills mounted on this employee, adding "
        "its tools and prompt fragment to the conversation. **You must "
        "actually invoke this tool — do not write `resolve_skill(...)` "
        "as a chat message; the user will see only that text and nothing "
        "happens.** Idempotent: calling twice is a no-op. Pass `skill_id` "
        "(one of the IDs listed under 'Available Skills' in the system "
        "prompt). Activation is the prerequisite for using a skill's "
        "tools — until you call this, the skill's tools are NOT in your "
        "tool list."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "skill_id": {
                "type": "string",
                "description": (
                    "One of the skills mounted on the current employee. See the "
                    "'Available skills' list in the system prompt."
                ),
            }
        },
        "required": ["skill_id"],
    },
    output_schema={
        "type": "object",
        "properties": {
            "tool_ids": {"type": "array", "items": {"type": "string"}},
            "prompt_fragment": {"type": "string"},
            "already_loaded": {"type": "boolean"},
            "skill_id": {"type": "string"},
            "hint": {"type": "string"},
            "error": {"type": "string"},
        },
    },
    scope=ToolScope.READ,
    requires_confirmation=False,
)


ResolveSkillExecutor = Callable[..., Awaitable[dict[str, Any]]]


def make_resolve_skill_executor(
    *,
    employee: Any,
    runtime: SkillRuntime,
    skill_registry: SkillRegistry,
) -> ResolveSkillExecutor:
    """Bind the executor to this conversation's runtime + employee whitelist.

    The runner creates one executor per AgentRunner instance so that mutations
    land on the correct SkillRuntime; cross-conversation isolation is enforced
    by bootstrapping a fresh runtime per conversation (contract § 5.1 behavior).
    """

    whitelist = set(employee.skill_ids)

    async def _execute(skill_id: str) -> dict[str, Any]:
        if skill_id not in whitelist:
            return {
                "error": (
                    f"skill_id {skill_id!r} is not mounted on this employee. "
                    f"Mounted skills: {sorted(whitelist)}."
                )
            }
        if skill_id in runtime.resolved_skills:
            return {
                "already_loaded": True,
                "tool_ids": list(runtime.resolved_skills[skill_id]),
                "prompt_fragment": "",
                "skill_id": skill_id,
                "hint": (
                    "Skill already active. Use read_skill_file(skill_id, "
                    "relative_path) to pull references/ or templates/ on demand."
                ),
            }
        skill = skill_registry.get_full(skill_id)
        if skill is None:
            return {"error": f"skill_id {skill_id!r} not found in skill registry."}
        runtime.resolved_skills[skill_id] = list(skill.tool_ids)
        if skill.prompt_fragment:
            runtime.resolved_fragments.append(skill.prompt_fragment)
        # ADR 0015 Phase 2: lazy-load SKILL.md body from the skill's install
        # dir. `path` is set for YAML-backed builtins (Phase 1) and installed
        # skills; legacy eager seeds have path=None and skip this step.
        if skill.path:
            body = read_skill_body(Path(skill.path))
            if body:
                runtime.resolved_fragments.append(body)
        return {
            "already_loaded": False,
            "tool_ids": list(skill.tool_ids),
            "prompt_fragment": skill.prompt_fragment or "",
            "skill_id": skill_id,
            "hint": (
                "Skill activated. Use read_skill_file(skill_id, relative_path) "
                "to pull references/, templates/, or scripts/ content when needed."
            ),
        }

    return _execute
