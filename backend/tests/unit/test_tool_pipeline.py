"""ADR 0018 · tool_pipeline tests · partition + execute_tool_use lifecycle.

The pipeline is the only path tools take from a committed AssistantMessage's
ToolUseBlocks to a recorded ToolMessage. Stages:
  validate → permission_check → maybe_defer → execute → record.

Concurrency constraint: deferred tools are ALWAYS in their own serial
batch (partition_tool_uses guarantees this). So:
  - execute_tool_use_iter — async generator · serial only · may yield
    ConfirmationRequested mid-stream before final ToolMessageCommitted
  - execute_tool_use_concurrent — async fn · parallel-safe path · returns
    Message directly (no defer possible)
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from allhands.core import Tool, ToolKind, ToolScope
from allhands.core.conversation import ToolUseBlock
from allhands.execution.deferred import (
    ConfirmationDeferred,  # noqa: F401  — for typing reference in tests
    DeferredOutcome,
    DeferredRequest,
    DeferredSignal,
)
from allhands.execution.internal_events import (
    ConfirmationRequested,
    ToolMessageCommitted,
)
from allhands.execution.tool_pipeline import (
    Allow,
    Defer,
    Deny,
    ToolBinding,
    execute_tool_use_concurrent,
    execute_tool_use_iter,
    partition_tool_uses,
)

# --- Helpers ----------------------------------------------------------------


def _tool(
    name: str,
    *,
    scope: ToolScope = ToolScope.READ,
    requires_confirmation: bool = False,
) -> Tool:
    return Tool(
        id=f"t.{name}",
        kind=ToolKind.BACKEND,
        name=name,
        description=f"{name} tool",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        scope=scope,
        requires_confirmation=requires_confirmation,
    )


def _bindings(*tools_and_execs: tuple[Tool, Any]) -> dict[str, ToolBinding]:
    return {t.name: ToolBinding(tool=t, executor=ex) for t, ex in tools_and_execs}


# --- partition_tool_uses ----------------------------------------------------


def test_partition_groups_consecutive_read_only_tools() -> None:
    a, b, c = _tool("a"), _tool("b"), _tool("c")

    async def _ex(**_: Any) -> dict[str, Any]:
        return {}

    bindings = _bindings((a, _ex), (b, _ex), (c, _ex))
    uses = [
        ToolUseBlock(id="1", name="a", input={}),
        ToolUseBlock(id="2", name="b", input={}),
        ToolUseBlock(id="3", name="c", input={}),
    ]
    batches = partition_tool_uses(uses, bindings)
    assert len(batches) == 1
    assert batches[0].is_concurrent_safe
    assert [b.id for b in batches[0].blocks] == ["1", "2", "3"]


def test_partition_breaks_on_write_tool() -> None:
    r1, w, r2 = (
        _tool("r1"),
        _tool("w", scope=ToolScope.WRITE, requires_confirmation=True),
        _tool("r2"),
    )

    async def _ex(**_: Any) -> dict[str, Any]:
        return {}

    bindings = _bindings((r1, _ex), (w, _ex), (r2, _ex))
    uses = [
        ToolUseBlock(id="1", name="r1", input={}),
        ToolUseBlock(id="2", name="w", input={}),
        ToolUseBlock(id="3", name="r2", input={}),
    ]
    batches = partition_tool_uses(uses, bindings)
    assert len(batches) == 3
    assert batches[0].is_concurrent_safe is True and [b.id for b in batches[0].blocks] == ["1"]
    assert batches[1].is_concurrent_safe is False and [b.id for b in batches[1].blocks] == ["2"]
    assert batches[2].is_concurrent_safe is True and [b.id for b in batches[2].blocks] == ["3"]


def test_partition_treats_unknown_tool_as_serial() -> None:
    """If the LLM hallucinates a tool name not in bindings, treat that
    block as its own serial batch — execute_tool_use will record the
    error message; we don't gather it with real reads."""
    a = _tool("a")

    async def _ex(**_: Any) -> dict[str, Any]:
        return {}

    bindings = _bindings((a, _ex))
    uses = [
        ToolUseBlock(id="1", name="a", input={}),
        ToolUseBlock(id="2", name="ghost", input={}),
        ToolUseBlock(id="3", name="a", input={}),
    ]
    batches = partition_tool_uses(uses, bindings)
    assert [b.is_concurrent_safe for b in batches] == [True, False, True]


def test_partition_requires_confirmation_read_treated_as_serial() -> None:
    """A READ-scope tool with requires_confirmation=True still goes
    serial (it'll defer). Concurrent batch is only for true zero-side-
    effect tools."""
    a = _tool("a", scope=ToolScope.READ, requires_confirmation=True)

    async def _ex(**_: Any) -> dict[str, Any]:
        return {}

    bindings = _bindings((a, _ex))
    uses = [ToolUseBlock(id="1", name="a", input={})]
    batches = partition_tool_uses(uses, bindings)
    assert batches[0].is_concurrent_safe is False


# --- Permission decision construction --------------------------------------


def test_allow_defer_deny_are_distinct_types() -> None:
    a = Allow()
    sig = _make_fake_signal()
    d = Defer(signal=sig, publish_kwargs={"x": 1})
    n = Deny(reason="not allowed")
    assert isinstance(a, Allow) and not isinstance(a, Defer)
    assert isinstance(d, Defer) and d.publish_kwargs == {"x": 1}
    assert isinstance(n, Deny) and n.reason == "not allowed"


# --- execute_tool_use_concurrent (parallel-safe path) ----------------------


@pytest.mark.asyncio
async def test_concurrent_path_runs_executor_directly_returns_message() -> None:
    a = _tool("a")

    async def _ex(**kw: Any) -> dict[str, int]:
        return {"x": kw.get("v", 0) * 2}

    bindings = _bindings((a, _ex))
    block = ToolUseBlock(id="tu1", name="a", input={"v": 21})
    msg = await execute_tool_use_concurrent(block, bindings)
    assert msg.role == "tool"
    assert msg.tool_call_id == "tu1"
    # Content is the structured executor return — caller decides serialization
    assert msg.content == {"x": 42}


@pytest.mark.asyncio
async def test_concurrent_path_unknown_tool_returns_error_message() -> None:
    bindings: dict[str, ToolBinding] = {}
    block = ToolUseBlock(id="tu1", name="ghost", input={})
    msg = await execute_tool_use_concurrent(block, bindings)
    assert msg.tool_call_id == "tu1"
    assert isinstance(msg.content, dict) and "error" in msg.content


@pytest.mark.asyncio
async def test_concurrent_path_executor_exception_returns_error_message() -> None:
    a = _tool("a")

    async def _ex(**_: Any) -> dict[str, Any]:
        raise RuntimeError("boom")

    bindings = _bindings((a, _ex))
    block = ToolUseBlock(id="tu1", name="a", input={})
    msg = await execute_tool_use_concurrent(block, bindings)
    assert isinstance(msg.content, dict)
    assert "boom" in str(msg.content.get("error", ""))


@pytest.mark.asyncio
async def test_concurrent_runs_three_tools_in_parallel() -> None:
    """Verify partition + asyncio.gather actually parallelizes — total
    elapsed should approximate max(individual) not sum(individuals)."""
    a, b, c = _tool("a"), _tool("b"), _tool("c")

    async def _slow(delay: float, value: int) -> dict[str, int]:
        await asyncio.sleep(delay)
        return {"value": value}

    async def _ea(**_: Any) -> dict[str, int]:
        return await _slow(0.1, 1)

    async def _eb(**_: Any) -> dict[str, int]:
        return await _slow(0.1, 2)

    async def _ec(**_: Any) -> dict[str, int]:
        return await _slow(0.1, 3)

    bindings = _bindings((a, _ea), (b, _eb), (c, _ec))
    blocks = [
        ToolUseBlock(id="1", name="a", input={}),
        ToolUseBlock(id="2", name="b", input={}),
        ToolUseBlock(id="3", name="c", input={}),
    ]

    start = asyncio.get_event_loop().time()
    msgs = await asyncio.gather(*[execute_tool_use_concurrent(b, bindings) for b in blocks])
    elapsed = asyncio.get_event_loop().time() - start

    # Gather of three 100ms tasks should finish in well under 200ms
    assert elapsed < 0.2, f"expected parallel (~0.1s), got {elapsed:.3f}s"
    assert [m.content["value"] for m in msgs] == [1, 2, 3]
    assert [m.tool_call_id for m in msgs] == ["1", "2", "3"]


# --- execute_tool_use_iter (serial path, with deferred) --------------------


@pytest.mark.asyncio
async def test_iter_yields_terminal_for_allowed_tool() -> None:
    a = _tool("a")

    async def _ex(**_: Any) -> dict[str, int]:
        return {"ok": 1}

    bindings = _bindings((a, _ex))
    block = ToolUseBlock(id="tu1", name="a", input={})

    def perm(_b: ToolUseBlock, _t: Tool) -> Allow | Defer | Deny:
        return Allow()

    events = [ev async for ev in execute_tool_use_iter(block, bindings, perm)]
    assert len(events) == 1
    assert isinstance(events[0], ToolMessageCommitted)
    assert events[0].message.content == {"ok": 1}


@pytest.mark.asyncio
async def test_iter_emits_confirmation_requested_then_terminal_on_approve() -> None:
    """Defer path: the iterator yields ConfirmationRequested IMMEDIATELY
    (so the UI shows the dialog), then awaits the signal, then yields
    the terminal ToolMessageCommitted."""
    a = _tool("a", scope=ToolScope.WRITE, requires_confirmation=True)

    async def _ex(**_: Any) -> dict[str, str]:
        return {"executed": "yes"}

    bindings = _bindings((a, _ex))
    block = ToolUseBlock(id="tu1", name="a", input={"k": "v"})

    sig = _ApprovingSignal()

    def perm(_b: ToolUseBlock, _t: Tool) -> Allow | Defer | Deny:
        return Defer(signal=sig, publish_kwargs={"summary": "do a", "rationale": "test"})

    collected = []
    async for ev in execute_tool_use_iter(block, bindings, perm):
        collected.append(ev)
        if isinstance(ev, ConfirmationRequested):
            # Simulate UI flipping the signal as soon as the request lands
            sig.approve()

    types = [type(ev).__name__ for ev in collected]
    assert types == ["ConfirmationRequested", "ToolMessageCommitted"]
    assert collected[0].tool_use_id == "tu1"
    assert collected[0].summary == "do a"
    assert collected[1].message.content == {"executed": "yes"}


@pytest.mark.asyncio
async def test_iter_returns_rejected_message_on_reject() -> None:
    a = _tool("a", scope=ToolScope.WRITE, requires_confirmation=True)

    async def _ex(**_: Any) -> dict[str, Any]:
        raise AssertionError("executor must NOT run on reject")

    bindings = _bindings((a, _ex))
    block = ToolUseBlock(id="tu1", name="a", input={})

    sig = _RejectingSignal()

    def perm(_b: ToolUseBlock, _t: Tool) -> Allow | Defer | Deny:
        return Defer(signal=sig, publish_kwargs={"summary": "x", "rationale": "y"})

    events = [ev async for ev in execute_tool_use_iter(block, bindings, perm)]
    assert len(events) == 2
    assert isinstance(events[0], ConfirmationRequested)
    assert isinstance(events[1], ToolMessageCommitted)
    assert isinstance(events[1].message.content, dict)
    assert "rejected" in str(events[1].message.content.get("error", ""))


@pytest.mark.asyncio
async def test_iter_returns_deny_immediately_without_executor() -> None:
    a = _tool("a")

    async def _ex(**_: Any) -> dict[str, Any]:
        raise AssertionError("executor must NOT run on deny")

    bindings = _bindings((a, _ex))
    block = ToolUseBlock(id="tu1", name="a", input={})

    def perm(_b: ToolUseBlock, _t: Tool) -> Allow | Defer | Deny:
        return Deny(reason="plan_mode_blocks_writes")

    events = [ev async for ev in execute_tool_use_iter(block, bindings, perm)]
    assert len(events) == 1
    assert isinstance(events[0], ToolMessageCommitted)
    assert "plan_mode_blocks_writes" in str(events[0].message.content.get("error", ""))


@pytest.mark.asyncio
async def test_iter_returns_error_for_unknown_tool() -> None:
    bindings: dict[str, ToolBinding] = {}
    block = ToolUseBlock(id="tu1", name="ghost", input={})

    def perm(_b: ToolUseBlock, _t: Tool) -> Allow | Defer | Deny:
        return Allow()  # never reached

    events = [ev async for ev in execute_tool_use_iter(block, bindings, perm)]
    assert len(events) == 1
    assert isinstance(events[0], ToolMessageCommitted)
    assert "unknown" in str(events[0].message.content.get("error", "")).lower()


@pytest.mark.asyncio
async def test_iter_executor_exception_records_failed_message() -> None:
    a = _tool("a")

    async def _ex(**_: Any) -> dict[str, Any]:
        raise ValueError("explode")

    bindings = _bindings((a, _ex))
    block = ToolUseBlock(id="tu1", name="a", input={})

    def perm(_b: ToolUseBlock, _t: Tool) -> Allow | Defer | Deny:
        return Allow()

    events = [ev async for ev in execute_tool_use_iter(block, bindings, perm)]
    assert len(events) == 1
    assert isinstance(events[0], ToolMessageCommitted)
    assert "explode" in str(events[0].message.content.get("error", ""))


# --- Fake signals used by tests --------------------------------------------


class _ApprovingSignal(DeferredSignal):
    """Test fake · publish() returns immediately with synthetic id; wait()
    blocks on an asyncio.Event flipped by ``approve()``. Spec-compliant
    DeferredSignal."""

    def __init__(self) -> None:
        self._evt = asyncio.Event()
        self._approved = False

    def approve(self) -> None:
        self._approved = True
        self._evt.set()

    def reject(self) -> None:
        self._approved = False
        self._evt.set()

    async def publish(self, **_: Any) -> DeferredRequest:
        return DeferredRequest(request_id="r1", confirmation_id="c1")

    async def wait(self, _req: DeferredRequest) -> DeferredOutcome:
        await self._evt.wait()
        return DeferredOutcome(kind="approved" if self._approved else "rejected")


class _RejectingSignal(_ApprovingSignal):
    def __init__(self) -> None:
        super().__init__()
        self._approved = False
        self._evt.set()  # immediate rejection


def _make_fake_signal() -> DeferredSignal:
    return _ApprovingSignal()
