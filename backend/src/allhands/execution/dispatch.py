"""DispatchService — enforces the agent-design § 6.2 dispatch contract.

Seven rules (§ 6.2):

1. **new thread_id** — sub-run gets a fresh LangGraph thread, not the parent's
2. **parent_run_id threaded** — every sub-run Message carries parent_run_id
3. **context isolation** — sub-employee's system_prompt is base + "当前父任务: …"
   (+ resolved context_refs). Parent conversation messages are NOT injected.
4. **Confirmation Gate 穿透** — same `gate` passed into sub-runner; WRITE tools
   in sub-run still prompt the user.
5. **MAX_DISPATCH_DEPTH=3** (env-overridable) — depth=0 is Lead; at depth≥3
   calling dispatch raises `MaxDispatchDepthExceeded`.
6. **independent iteration budget** — sub-run counts its own max_iterations;
   the dispatch call itself consumes one iteration of the parent.
7. **nested trace** — child run.* events carry parent run_id so the trace viewer renders them as sub-runs.

Depth + parent_run_id are carried through the Python task via contextvars so
that nested dispatch calls see the correct ambient state without threading
kwargs through the LangGraph loop.
"""

from __future__ import annotations

import os
import uuid
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Protocol

from pydantic import BaseModel, Field

from allhands.core.errors import EmployeeNotFound, MaxDispatchDepthExceeded

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from allhands.core import Employee
    from allhands.execution.event_bus import EventBus
    from allhands.execution.events import AgentEvent
    from allhands.persistence.repositories import EmployeeRepo


# ---- Ambient run context ----------------------------------------------------

_dispatch_depth: ContextVar[int] = ContextVar("allhands_dispatch_depth", default=0)
_parent_run_id: ContextVar[str | None] = ContextVar("allhands_parent_run_id", default=None)
# Optional: set by ChatService at the top of each turn so subagents can
# attribute their run.* events back to the parent's conversation. Empty
# string when running outside a chat turn (tests, CLI).
_parent_conversation_id: ContextVar[str | None] = ContextVar(
    "allhands_parent_conversation_id", default=None
)


def current_dispatch_depth() -> int:
    return _dispatch_depth.get()


def current_parent_run_id() -> str | None:
    return _parent_run_id.get()


def current_parent_conversation_id() -> str | None:
    return _parent_conversation_id.get()


def _default_max_depth() -> int:
    raw = os.environ.get("ALLHANDS_MAX_DISPATCH_DEPTH", "3")
    try:
        value = int(raw)
    except ValueError:
        return 3
    return max(1, value)


# ---- Result + runner factory -----------------------------------------------


class DispatchResult(BaseModel):
    """Outcome of a `dispatch_employee` call (agent-design § 6.1).

    Optional render-envelope fields (component / props / interactions /
    extra_renders) carry sub-agent render payloads up to the parent's
    chat — so when a dispatched employee produces an artifact, the
    parent UI shows the card instead of just the spawn result text.
    Mirrors the spawn_subagent forwarding contract.
    """

    run_id: str
    status: str  # "succeeded" | "err_max_depth" | "err_sub_run_failed" | "err_timeout"
    summary: str
    output_refs: list[str] = Field(default_factory=list)
    thread_id: str | None = None
    parent_run_id: str | None = None
    # Render forwarding · None when sub-agent didn't produce a render
    component: str | None = None
    props: dict[str, object] | None = None
    interactions: list[object] | None = None
    extra_renders: list[dict[str, object]] | None = None


class SubRunner(Protocol):
    """Minimal interface the DispatchService needs from AgentRunner."""

    def stream(
        self,
        messages: list[dict[str, object]],
        thread_id: str,
    ) -> AsyncIterator[AgentEvent]: ...


class RunnerFactory(Protocol):
    """Builds a SubRunner for a given (employee, depth). Supplied by ChatService."""

    def __call__(self, employee: Employee, depth: int) -> SubRunner: ...


# ---- Service ---------------------------------------------------------------


def build_child_system_prompt(
    base_prompt: str,
    parent_task: str,
    context_refs: list[str] | None = None,
) -> str:
    """Compose the sub-employee's system prompt per § 6.2 rule 3."""
    parts = [base_prompt.rstrip(), "\n\n---\n\n当前父任务:\n" + parent_task.strip()]
    refs = context_refs or []
    if refs:
        parts.append("\n\n引用先前产出:\n" + "\n".join(f"- {r}" for r in refs))
    return "".join(parts)


class DispatchService:
    def __init__(
        self,
        employee_repo: EmployeeRepo,
        runner_factory: RunnerFactory,
        max_depth: int | None = None,
        event_bus: EventBus | None = None,
    ) -> None:
        self._employees = employee_repo
        self._runner_factory = runner_factory
        self._max_depth = max_depth if max_depth is not None else _default_max_depth()
        # Optional event_bus · when wired, every dispatch emits run.started +
        # run.completed/failed so observatory's ``get_run_detail`` can find
        # the sub-run by its run_id (mirrors chat_service contract). When
        # None, subagent runs leave no trace — that was the pre-2026-04-27
        # bug behind "trace 已不在".
        self._bus = event_bus

    @property
    def max_depth(self) -> int:
        return self._max_depth

    async def dispatch(
        self,
        employee_id: str,
        task: str,
        context_refs: list[str] | None = None,
        timeout_seconds: int = 300,
    ) -> DispatchResult:
        current_depth = _dispatch_depth.get()
        new_depth = current_depth + 1
        if new_depth >= self._max_depth:
            raise MaxDispatchDepthExceeded(depth=new_depth, limit=self._max_depth)

        employee = await self._employees.get(employee_id)
        if employee is None:
            raise EmployeeNotFound(employee_id)

        child = employee.model_copy(
            update={
                "system_prompt": build_child_system_prompt(
                    employee.system_prompt, task, context_refs
                )
            }
        )
        run_id = str(uuid.uuid4())
        thread_id = str(uuid.uuid4())
        invoker_run_id = _parent_run_id.get()
        invoker_conversation_id = _parent_conversation_id.get() or ""

        depth_token = _dispatch_depth.set(new_depth)
        parent_token = _parent_run_id.set(run_id)
        run_started_at = datetime.now(UTC)
        # Emit run.started so observatory.get_run_detail can find this
        # sub-run later. parent_run_id chains the trace tree; depth lets
        # the trace viewer indent properly.
        if self._bus is not None:
            self._bus.publish_best_effort(
                kind="run.started",
                payload={
                    "run_id": run_id,
                    "employee_id": child.id,
                    "conversation_id": invoker_conversation_id,
                    "depth": new_depth,
                    "parent_run_id": invoker_run_id,
                },
            )
        try:
            runner = self._runner_factory(child, new_depth)
            summary_parts: list[str] = []
            renders: list[dict[str, object]] = []
            error_msg: str | None = None
            async for event in runner.stream(
                messages=[{"role": "user", "content": task}],
                thread_id=thread_id,
            ):
                # Collect text tokens; sub-run's structured events are consumed here
                # in v0 (non-streaming dispatch). §9 defers child-to-parent streaming.
                kind = getattr(event, "kind", None)
                if kind == "token":
                    summary_parts.append(getattr(event, "delta", ""))
                elif kind == "render":
                    payload = getattr(event, "payload", None)
                    if payload is not None:
                        try:
                            envelope = payload.model_dump()
                        except AttributeError:
                            envelope = dict(payload) if isinstance(payload, dict) else None
                        if isinstance(envelope, dict):
                            renders.append(envelope)
                elif kind == "error":
                    error_msg = getattr(event, "message", "sub-run failed")
                    break
        finally:
            _parent_run_id.reset(parent_token)
            _dispatch_depth.reset(depth_token)

        duration_s = (datetime.now(UTC) - run_started_at).total_seconds()
        if error_msg is not None:
            if self._bus is not None:
                self._bus.publish_best_effort(
                    kind="run.failed",
                    payload={
                        "run_id": run_id,
                        "employee_id": child.id,
                        "conversation_id": invoker_conversation_id,
                        "duration_s": duration_s,
                        "error": error_msg,
                        "parent_run_id": invoker_run_id,
                    },
                )
            return DispatchResult(
                run_id=run_id,
                status="err_sub_run_failed",
                summary=error_msg,
                thread_id=thread_id,
                parent_run_id=invoker_run_id,
            )

        if self._bus is not None:
            self._bus.publish_best_effort(
                kind="run.completed",
                payload={
                    "run_id": run_id,
                    "employee_id": child.id,
                    "conversation_id": invoker_conversation_id,
                    "duration_s": duration_s,
                    "parent_run_id": invoker_run_id,
                },
            )

        out = DispatchResult(
            run_id=run_id,
            status="succeeded",
            summary="".join(summary_parts).strip() or "(no output)",
            thread_id=thread_id,
            parent_run_id=invoker_run_id,
        )
        # Forward render envelopes so parent chat shows the artifact card
        # produced by the dispatched employee. Mirrors spawn_subagent.
        if renders:
            first = renders[0]
            comp = first.get("component")
            if isinstance(comp, str) and comp:
                out = out.model_copy(
                    update={
                        "component": comp,
                        "props": first.get("props") if isinstance(first.get("props"), dict) else {},
                        "interactions": first.get("interactions")
                        if isinstance(first.get("interactions"), list)
                        else [],
                        "extra_renders": renders[1:] if len(renders) > 1 else None,
                    }
                )
        return out
