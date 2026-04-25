"""ADR 0018 · ToolPipeline · the only path tools take from the agent loop.

A committed AssistantMessage's ToolUseBlocks flow through:

    validate → permission_check → maybe_defer → execute → record

into terminal ToolMessages, which the agent loop appends to history
before the next LLM turn. Concurrency policy mirrors Claude Code's
`partitionToolCalls`:

    - consecutive read-only tools (scope=READ ∧ ¬requires_confirmation)
      go in one concurrent batch (asyncio.gather)
    - any tool that may defer (write/irreversible/bootstrap or
      requires_confirmation) is its own serial batch

The serial path is an async generator (`execute_tool_use_iter`) so it
can yield ConfirmationRequested mid-execution before awaiting the
deferred signal. The concurrent path is a plain coroutine
(`execute_tool_use_concurrent`) that returns the terminal Message
directly — no events yielded mid-flight, gather composes naturally.
"""

from __future__ import annotations

import inspect
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from allhands.core import Tool, ToolScope
from allhands.core.conversation import Message, ToolUseBlock
from allhands.execution.deferred import DeferredOutcome, DeferredRequest, DeferredSignal
from allhands.execution.internal_events import (
    ConfirmationRequested,
    InternalEvent,
    ToolMessageCommitted,
)

if TYPE_CHECKING:
    from allhands.execution.registry import ToolExecutor


# --- Types -----------------------------------------------------------------


@dataclass
class ToolBinding:
    """One callable tool · meta + bound executor closure.

    The executor is whatever the agent loop wired in for THIS turn —
    skill / dispatch / subagent special cases inject their own closure
    over the loop's services. ToolPipeline doesn't know about those
    specials; it just calls the closure.
    """

    tool: Tool
    executor: ToolExecutor


@dataclass
class Allow:
    """Permission decision · proceed straight to execute."""


@dataclass
class Defer:
    """Permission decision · suspend awaiting an external signal.

    `signal` does the actual publish/wait. `publish_kwargs` is splatted
    into `signal.publish(**kwargs)`. After signal.wait() resolves to
    "approved", the executor runs; any other outcome records a
    rejected/expired ToolMessage.
    """

    signal: DeferredSignal
    publish_kwargs: dict[str, Any]


@dataclass
class Deny:
    """Permission decision · refuse without asking the user.

    Used by mode-based blocks (e.g. plan mode forbids writes) — the
    rejection lands in the tool_message so the LLM sees it on the next
    turn and can adjust.
    """

    reason: str


PermissionDecision = Allow | Defer | Deny

# Loop-supplied permission check. Receives the about-to-execute
# ToolUseBlock + its Tool meta; returns one of three decisions. Pure
# function (no side effects) — Defer's signal handles persistence.
PermissionChecker = Callable[[ToolUseBlock, Tool], PermissionDecision]


@dataclass
class Batch:
    """One execution batch · either one concurrent gather of read-only
    tools, or one serial step of a single deferable tool."""

    is_concurrent_safe: bool
    blocks: list[ToolUseBlock]


# --- Partitioning ----------------------------------------------------------


def _is_concurrent_safe(tool: Tool | None) -> bool:
    """A tool is concurrent-safe iff it's READ scope AND doesn't require
    confirmation. Any other combination — write, irreversible, bootstrap,
    or read-with-confirmation — gets its own serial batch."""
    if tool is None:
        return False
    return tool.scope == ToolScope.READ and not tool.requires_confirmation


def partition_tool_uses(
    uses: list[ToolUseBlock],
    bindings: dict[str, ToolBinding],
) -> list[Batch]:
    """Group consecutive read-only tools into concurrent batches.
    Order preserved. Unknown tools → their own serial batch (the error
    response is recorded by execute_tool_use_iter)."""
    out: list[Batch] = []
    for block in uses:
        binding = bindings.get(block.name)
        safe = _is_concurrent_safe(binding.tool if binding else None)
        if out and safe and out[-1].is_concurrent_safe:
            out[-1].blocks.append(block)
        else:
            out.append(Batch(is_concurrent_safe=safe, blocks=[block]))
    return out


# --- Helpers ---------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(UTC)


def _make_tool_message(
    *,
    tool_use_id: str,
    content: object,
    conversation_id: str = "",
) -> Message:
    """Build a tool-role Message that pairs with a ToolUseBlock by id.

    The `content` can be a structured dict (success payload) or a
    `{"error": "..."}` envelope (rejection / failure). Serialization
    to wire JSON happens in the AG-UI translator.
    """
    return Message(
        id=str(uuid.uuid4()),
        conversation_id=conversation_id,
        role="tool",
        content=content if isinstance(content, str) else "",
        tool_call_id=tool_use_id,
        created_at=_now(),
    ).model_copy(update={"content": content})


async def _maybe_await(value: Any) -> Any:
    """Executors can be async OR sync; tests construct fakes both ways.
    This dual-mode helper keeps both contracts callable."""
    if inspect.isawaitable(value):
        return await value
    return value


async def _invoke_executor(
    executor: ToolExecutor,
    args: dict[str, Any],
) -> Any:
    """Call the bound tool executor with the LLM-provided args.

    Wrapping in try/except is the caller's responsibility — different
    paths (concurrent vs iter) record errors differently.
    """
    return await _maybe_await(executor(**args))


# --- Concurrent path (parallel-safe, no defer possible) -------------------


async def execute_tool_use_concurrent(
    block: ToolUseBlock,
    bindings: dict[str, ToolBinding],
    *,
    conversation_id: str = "",
) -> Message:
    """Execute one read-only tool with no permission/defer machinery.

    Caller (agent loop) gets the terminal ToolMessage back; pairs into
    asyncio.gather for batched concurrent reads.
    """
    binding = bindings.get(block.name)
    if binding is None:
        return _make_tool_message(
            tool_use_id=block.id,
            content={"error": f"unknown tool {block.name!r}"},
            conversation_id=conversation_id,
        )
    try:
        result = await _invoke_executor(binding.executor, dict(block.input))
    except Exception as exc:
        return _make_tool_message(
            tool_use_id=block.id,
            content={"error": f"{type(exc).__name__}: {exc}"},
            conversation_id=conversation_id,
        )
    return _make_tool_message(
        tool_use_id=block.id,
        content=result,
        conversation_id=conversation_id,
    )


# --- Serial path (may defer) ----------------------------------------------


async def execute_tool_use_iter(
    block: ToolUseBlock,
    bindings: dict[str, ToolBinding],
    permission_check: PermissionChecker,
    *,
    conversation_id: str = "",
) -> AsyncIterator[InternalEvent]:
    """Serial execution. Yields ConfirmationRequested when deferring,
    then yields a ToolMessageCommitted as the terminal event.

    The agent loop iterates this; it can pump UI events through the
    main stream while the deferred signal awaits external resolution.
    """
    binding = bindings.get(block.name)
    if binding is None:
        yield ToolMessageCommitted(
            message=_make_tool_message(
                tool_use_id=block.id,
                content={"error": f"unknown tool {block.name!r}"},
                conversation_id=conversation_id,
            )
        )
        return

    decision = permission_check(block, binding.tool)

    if isinstance(decision, Deny):
        yield ToolMessageCommitted(
            message=_make_tool_message(
                tool_use_id=block.id,
                content={"error": f"denied: {decision.reason}"},
                conversation_id=conversation_id,
            )
        )
        return

    if isinstance(decision, Defer):
        kwargs = dict(decision.publish_kwargs)
        # Pipeline injects tool_use_id consistently — caller may rely
        # on it, but doesn't have to specify it in publish_kwargs.
        kwargs.setdefault("tool_use_id", block.id)
        request = await decision.signal.publish(**kwargs)
        # Surface the request to the UI BEFORE awaiting wait(); the
        # frontend dialog opens immediately.
        yield ConfirmationRequested(
            confirmation_id=request.confirmation_id or request.request_id,
            tool_use_id=block.id,
            summary=str(kwargs.get("summary", "")),
            rationale=str(kwargs.get("rationale", "")),
            diff=kwargs.get("diff"),
        )
        outcome = await decision.signal.wait(request)
        if outcome.kind not in ("approved", "answered", "completed"):
            yield ToolMessageCommitted(
                message=_make_tool_message(
                    tool_use_id=block.id,
                    content={"error": f"{outcome.kind} by user"},
                    conversation_id=conversation_id,
                )
            )
            return

    # Allow path or post-approval Defer path: invoke executor.
    try:
        result = await _invoke_executor(binding.executor, dict(block.input))
    except Exception as exc:
        yield ToolMessageCommitted(
            message=_make_tool_message(
                tool_use_id=block.id,
                content={"error": f"{type(exc).__name__}: {exc}"},
                conversation_id=conversation_id,
            )
        )
        return
    yield ToolMessageCommitted(
        message=_make_tool_message(
            tool_use_id=block.id,
            content=result,
            conversation_id=conversation_id,
        )
    )


__all__ = [
    "Allow",
    "Batch",
    "Defer",
    "Deny",
    "PermissionChecker",
    "PermissionDecision",
    "ToolBinding",
    "execute_tool_use_concurrent",
    "execute_tool_use_iter",
    "partition_tool_uses",
]


# Suppress unused-import warning for type re-exports during tests
_ = (DeferredOutcome, DeferredRequest)
