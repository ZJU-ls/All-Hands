"""spawn_subagent — launch an isolated child AgentRunner for a scoped task.

Spec: docs/specs/agent-runtime-contract.md § 5.2 + § 9.2.
Ref: ref-src-claude/V10-multi-agent.md § 2.2 `runAgent` · in-process
AsyncLocalStorage iframe isolation · each spawned agent has its own
state scope. § 4.5 · teammates cannot spawn teammates (v0 hard cap).
Ref: ref-src-claude/V04-tool-call-mechanism.md § 2.1 · Tool scope
declaration · WRITE → ConfirmationGate before running.

This tool is the meta-level counterpart to the `dispatch_employee`
meta tool: both hand a self-contained task to a child runner, but
`spawn_subagent` additionally accepts a *preset profile* (execute /
plan / plan_with_subagent) so coordinator agents can spawn on demand
without having to pre-create a registered employee.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Protocol

from allhands.core import Employee, Tool, ToolKind, ToolScope
from allhands.execution.dispatch import _dispatch_depth, current_parent_run_id
from allhands.execution.modes import MODES, expand_preset

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from allhands.persistence.repositories import EmployeeRepo


SPAWN_SUBAGENT_TOOL = Tool(
    id="allhands.meta.spawn_subagent",
    kind=ToolKind.META,
    name="spawn_subagent",
    description=(
        "Spawn an isolated child agent to handle a self-contained task. Use "
        "when a step in your plan is better delegated: the child gets a fresh "
        "memory scope and sees only the task you pass in (no parent history). "
        "`profile` is one of 'execute' / 'plan' / 'plan_with_subagent' OR an "
        "existing employee name. Returns {result, trace_id, iterations_used, "
        "status}. v0: subagents cannot spawn further subagents."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "profile": {
                "type": "string",
                "description": (
                    "One of: 'execute' | 'plan' | 'plan_with_subagent' | an existing employee name."
                ),
            },
            "task": {
                "type": "string",
                "description": (
                    "Self-contained task description · this is the child's "
                    "sole user message. Include all context the child needs."
                ),
            },
            "return_format": {
                "type": "string",
                "description": (
                    "Optional hint for the child about result shape "
                    "(markdown / json / short summary)."
                ),
            },
            "max_iterations_override": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100,
                "description": (
                    "Optional · override the child's iteration budget "
                    "(defaults to the preset or employee setting)."
                ),
            },
        },
        "required": ["profile", "task"],
    },
    output_schema={
        "type": "object",
        "properties": {
            "result": {"type": "string"},
            "trace_id": {"type": "string"},
            "iterations_used": {"type": "integer"},
            "status": {
                "type": "string",
                "enum": ["completed", "max_iterations", "error"],
            },
        },
    },
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)


class SubRunner(Protocol):
    def stream(
        self,
        messages: list[dict[str, Any]],
        thread_id: str,
    ) -> AsyncIterator[Any]: ...


class SubRunnerFactory(Protocol):
    def __call__(self, employee: Employee, depth: int) -> SubRunner: ...


SpawnSubagentExecutor = Callable[..., Awaitable[dict[str, Any]]]


def _build_preset_child(
    preset_id: str,
    *,
    return_format: str | None,
    max_iterations_override: int | None,
) -> Employee:
    """Construct a throwaway in-memory Employee from a preset (contract § 4.2)."""
    tool_ids, skill_ids, max_it = expand_preset(
        preset_id,
        custom_max_iterations=max_iterations_override,
    )
    mod = MODES[preset_id]
    prompt_parts = [
        f"You are a {mod.LABEL_ZH} subagent spawned for a single task.",
        "You see only the user's task; you have no access to the parent conversation history.",
    ]
    if return_format:
        prompt_parts.append(f"Return format: {return_format}")
    return Employee(
        id=f"subagent-{uuid.uuid4().hex[:12]}",
        name=f"sub-{preset_id.replace('_', '-')[:30]}",
        description=f"Temporary {preset_id} subagent",
        system_prompt="\n\n".join(prompt_parts),
        model_ref="openai/gpt-4o-mini",
        tool_ids=list(tool_ids),
        skill_ids=list(skill_ids),
        max_iterations=int(max_it),
        created_by="subagent",
        created_at=datetime.now(UTC),
    )


class SpawnSubagentService:
    """Runs the v0 spawn_subagent semantics (contract § 5.2).

    The runner_factory contract matches the one used by DispatchService so
    ChatService can hand both services the same closure — wiring is uniform.
    """

    def __init__(
        self,
        employee_repo: EmployeeRepo | Any,
        runner_factory: SubRunnerFactory,
        max_depth: int = 1,
    ) -> None:
        self._employees = employee_repo
        self._runner_factory = runner_factory
        self._max_depth = max_depth

    async def spawn(
        self,
        *,
        profile: str,
        task: str,
        return_format: str | None = None,
        max_iterations_override: int | None = None,
    ) -> dict[str, Any]:
        # v0 nesting cap (contract § 5.2 · V10 § 4.5). A subagent is itself
        # executing inside a parent-dispatched scope; `_dispatch_depth` already
        # carries that context thanks to DispatchService, so we reuse it.
        current_depth = _dispatch_depth.get()
        if current_depth >= self._max_depth:
            return {
                "result": (
                    "Cannot nest spawn_subagent beyond depth "
                    f"{self._max_depth} · v0 forbids sub-subagents."
                ),
                "trace_id": "",
                "iterations_used": 0,
                "status": "error",
            }

        child = await self._resolve_child(
            profile=profile,
            return_format=return_format,
            max_iterations_override=max_iterations_override,
        )
        if child is None:
            return {
                "result": (
                    f"Unknown profile {profile!r} · not a preset "
                    "('execute'/'plan'/'plan_with_subagent') and not a registered employee."
                ),
                "trace_id": "",
                "iterations_used": 0,
                "status": "error",
            }

        trace_id = str(uuid.uuid4())
        thread_id = str(uuid.uuid4())
        new_depth = current_depth + 1
        depth_token = _dispatch_depth.set(new_depth)
        try:
            runner = self._runner_factory(child, new_depth)
            parts: list[str] = []
            status = "completed"
            async for event in runner.stream(
                messages=[{"role": "user", "content": task}],
                thread_id=thread_id,
            ):
                kind = getattr(event, "kind", None)
                if kind == "token":
                    parts.append(getattr(event, "delta", ""))
                elif kind == "error":
                    parts.append(getattr(event, "message", ""))
                    status = "error"
                    break
        finally:
            _dispatch_depth.reset(depth_token)

        return {
            "result": "".join(parts).strip(),
            "trace_id": trace_id,
            # v0: we don't yet track per-turn iterations inside the runner;
            # leave 0 · the events table records llm.call counts per run.
            "iterations_used": 0,
            "status": status,
            "parent_run_id": current_parent_run_id(),
        }

    async def _resolve_child(
        self,
        *,
        profile: str,
        return_format: str | None,
        max_iterations_override: int | None,
    ) -> Employee | None:
        if profile in MODES:
            return _build_preset_child(
                profile,
                return_format=return_format,
                max_iterations_override=max_iterations_override,
            )
        emp = await self._employees.get_by_name(profile)
        if emp is None:
            return None
        if max_iterations_override is not None:
            emp = emp.model_copy(update={"max_iterations": max_iterations_override})
        if return_format:
            emp = emp.model_copy(
                update={"system_prompt": emp.system_prompt + f"\n\nReturn format: {return_format}"}
            )
        return emp


def make_spawn_subagent_executor(service: SpawnSubagentService) -> SpawnSubagentExecutor:
    """Bind the service to a coroutine the runner can hand to StructuredTool."""

    async def _execute(
        profile: str,
        task: str,
        return_format: str | None = None,
        max_iterations_override: int | None = None,
    ) -> dict[str, Any]:
        return await service.spawn(
            profile=profile,
            task=task,
            return_format=return_format,
            max_iterations_override=max_iterations_override,
        )

    return _execute
