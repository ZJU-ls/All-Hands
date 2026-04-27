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

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Protocol

from allhands.core import Employee, Tool, ToolKind, ToolScope
from allhands.execution.dispatch import (
    _dispatch_depth,
    _parent_run_id,
    current_parent_conversation_id,
    current_parent_run_id,
)
from allhands.execution.modes import MODES, expand_preset

_log = logging.getLogger(__name__)

# Sub-agent watchdog. The parent's tool_pipeline awaits this executor and
# the SSE stream is paused on it the whole time — so a sub-agent that hangs
# (network blip / model timeout / inner loop deadlock) blocks the parent's
# turn entirely. Cap it at a generous default; user override via env if
# needed. Surfaces as a structured error envelope so the UI sees a normal
# tool_call_end with status=failed instead of `tool_call_dropped`.
DEFAULT_SPAWN_TIMEOUT_S = 180.0

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from allhands.execution.event_bus import EventBus
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
    # Spawning a subagent is itself benign — it just hands a task to a
    # child runner. The child has its own ConfirmationGate that fires for
    # any real WRITE inside its scope, so confirming at the spawn boundary
    # is a double-gate that produces "expired by user" when the user never
    # sees a prompt for "may I think harder about this?". Mirrors
    # `dispatch_employee` (employee_tools.py — also requires_confirmation=False).
    scope=ToolScope.WRITE,
    requires_confirmation=False,
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
    model_ref: str,
) -> Employee:
    """Construct a throwaway in-memory Employee from a preset (contract § 4.2).

    ``model_ref`` is now mandatory and inherits from the parent agent so the
    subagent talks to the same gateway. The previous hardcoded
    ``"openai/gpt-4o-mini"`` made spawn_subagent fail on any deployment that
    doesn't have an OpenAI provider registered (e.g. user's CodingPlan
    gateway with qwen / glm / kimi / minimax models). Reproducer:
    spawn_subagent → "Unknown model_ref" → executor exception → SSE drops
    tool_call mid-flight → frontend shows tool_call_dropped.
    """
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
        model_ref=model_ref,
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
        default_model_ref: str | None = None,
        event_bus: EventBus | None = None,
    ) -> None:
        self._employees = employee_repo
        self._runner_factory = runner_factory
        self._max_depth = max_depth
        # Inherited from the parent so the subagent talks to the same gateway.
        # When None, falls back to a sensible default (kept for backward compat
        # with tests that don't bind a parent model).
        self._default_model_ref = default_model_ref or "openai/gpt-4o-mini"
        # Optional event_bus · same role as DispatchService._bus — emits
        # run.started + run.completed/failed so observatory can find this
        # sub-run by its trace_id (which we also surface as run_id).
        self._bus = event_bus

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
        # R1 review · M5 — DispatchService sets _parent_run_id so nested
        # operations report the right trace lineage. spawn_subagent had to
        # mirror that or the subagent's tool calls were stamped with the
        # GRANDPARENT's run_id, breaking trace tree links in observatory.
        parent_run_token = _parent_run_id.set(trace_id)

        invoker_run_id = current_parent_run_id()
        invoker_conv_id = current_parent_conversation_id() or ""
        run_started_at = datetime.now(UTC)
        # Emit run.started so observatory.get_run_detail can find the sub-run
        # by ``trace_id`` (we surface it as ``run_id`` to the FE TraceChip).
        # Pre-2026-04-27 these events were never written and the drawer
        # showed "trace 已不在".
        if self._bus is not None:
            self._bus.publish_best_effort(
                kind="run.started",
                payload={
                    "run_id": trace_id,
                    "employee_id": child.id,
                    "conversation_id": invoker_conv_id,
                    "depth": new_depth,
                    "parent_run_id": invoker_run_id,
                },
            )

        async def _drive() -> tuple[list[str], str, list[dict[str, Any]]]:
            """Drive the inner runner · collect token text AND render envelopes.

            Render envelopes (Artifact.Preview / Artifact.Card) emitted by the
            sub-agent's tool calls would otherwise be trapped in the sub-stream
            — the parent's chat would only see the spawn result string. We
            forward the FIRST render envelope as the spawn_subagent tool
            return so `_as_render_envelope` detects it on the parent side and
            the chat shows the artifact card. Additional render envelopes are
            kept on the side for future fan-out (multi-card forwarding TBD).
            """
            runner = self._runner_factory(child, new_depth)
            parts: list[str] = []
            renders: list[dict[str, Any]] = []
            status_local = "completed"
            async for event in runner.stream(
                messages=[{"role": "user", "content": task}],
                thread_id=thread_id,
            ):
                kind = getattr(event, "kind", None)
                if kind == "token":
                    parts.append(getattr(event, "delta", ""))
                elif kind == "render":
                    payload = getattr(event, "payload", None)
                    if payload is not None:
                        # RenderPayload is a pydantic model; dump to dict so
                        # the executor return is JSON-serializable.
                        try:
                            envelope = payload.model_dump()
                        except AttributeError:
                            envelope = dict(payload) if isinstance(payload, dict) else None
                        if isinstance(envelope, dict):
                            renders.append(envelope)
                elif kind == "error":
                    msg = getattr(event, "message", "")
                    parts.append(str(msg))
                    status_local = "error"
                    _log.warning(
                        "spawn_subagent inner runner error: profile=%s msg=%s",
                        profile,
                        msg,
                    )
                    break
            return parts, status_local, renders

        def _emit_terminal(*, failed: bool, error_msg: str | None) -> None:
            if self._bus is None:
                return
            duration_s = (datetime.now(UTC) - run_started_at).total_seconds()
            self._bus.publish_best_effort(
                kind="run.failed" if failed else "run.completed",
                payload={
                    "run_id": trace_id,
                    "employee_id": child.id,
                    "conversation_id": invoker_conv_id,
                    "duration_s": duration_s,
                    "parent_run_id": invoker_run_id,
                    "error": error_msg,
                },
            )

        try:
            try:
                parts, status, renders = await asyncio.wait_for(
                    _drive(),
                    timeout=DEFAULT_SPAWN_TIMEOUT_S,
                )
            except TimeoutError:
                _log.warning(
                    "spawn_subagent timed out after %.0fs · profile=%s task[:80]=%r",
                    DEFAULT_SPAWN_TIMEOUT_S,
                    profile,
                    task[:80],
                )
                _emit_terminal(failed=True, error_msg="timeout")
                return {
                    "result": (
                        f"Subagent timed out after {DEFAULT_SPAWN_TIMEOUT_S:.0f}s "
                        "without producing output. The model may be hanging or the "
                        "inner task is too large. Consider breaking the task into "
                        "smaller pieces or raising max_iterations_override."
                    ),
                    "trace_id": trace_id,
                    "run_id": trace_id,
                    "iterations_used": 0,
                    "status": "error",
                    "parent_run_id": current_parent_run_id(),
                }
            except Exception as exc:
                _log.exception(
                    "spawn_subagent inner runner raised: profile=%s",
                    profile,
                )
                _emit_terminal(failed=True, error_msg=f"{type(exc).__name__}: {exc}")
                return {
                    "result": (f"Subagent crashed: {type(exc).__name__}: {exc}"),
                    "trace_id": trace_id,
                    "run_id": trace_id,
                    "iterations_used": 0,
                    "status": "error",
                    "parent_run_id": current_parent_run_id(),
                }
        finally:
            _dispatch_depth.reset(depth_token)
            _parent_run_id.reset(parent_run_token)

        _emit_terminal(
            failed=(status == "error"),
            error_msg=None if status != "error" else "inner runner reported error",
        )
        result_text = "".join(parts).strip()
        out: dict[str, Any] = {
            "result": result_text,
            "trace_id": trace_id,
            # Surface the same id under run_id so the FE TraceChip
            # (ToolCallCard.tsx) can detect this sub-run uniformly with
            # dispatch_employee — both feed into ?trace=<id> + RunTraceDrawer.
            "run_id": trace_id,
            "iterations_used": 0,
            "status": status,
            "parent_run_id": current_parent_run_id(),
        }
        # Forward the first render envelope from the sub-stream so the parent
        # chat shows the artifact card. Without this the sub-agent's
        # render_drawio / artifact_create produces an artifact in the panel
        # but the chat only sees the spawn_subagent tool return string —
        # users said 「chat 里没有渲染」when this happened. _as_render_envelope
        # picks {component, props, interactions} off the top-level dict.
        if renders:
            first = renders[0]
            component = first.get("component")
            if isinstance(component, str) and component:
                out["component"] = component
                props_val = first.get("props")
                out["props"] = props_val if isinstance(props_val, dict) else {}
                inter_val = first.get("interactions")
                out["interactions"] = inter_val if isinstance(inter_val, list) else []
                # Surface extra envelopes so future fan-out (multiple artifact
                # cards from one spawn) has a place to land.
                if len(renders) > 1:
                    out["extra_renders"] = renders[1:]
        return out

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
                model_ref=self._default_model_ref,
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
