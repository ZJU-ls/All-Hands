"""Tests for ConfirmationGate policies."""

from __future__ import annotations

from pathlib import Path

import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command
from typing_extensions import TypedDict

from allhands.core import Tool, ToolKind, ToolScope
from allhands.execution.gate import (
    AutoApproveGate,
    AutoRejectGate,
    InterruptConfirmationGate,
)


def _write_tool() -> Tool:
    return Tool(
        id="test.write",
        kind=ToolKind.BACKEND,
        name="write",
        description="write something",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        scope=ToolScope.WRITE,
        requires_confirmation=True,
    )


async def test_auto_approve_gate_always_approves() -> None:
    gate = AutoApproveGate()
    tool = _write_tool()
    outcome = await gate.request(
        tool=tool,
        args={},
        tool_call_id="tc1",
        rationale="test",
        summary="test",
    )
    assert outcome == "approved"


async def test_auto_reject_gate_always_rejects() -> None:
    gate = AutoRejectGate()
    tool = _write_tool()
    outcome = await gate.request(
        tool=tool,
        args={},
        tool_call_id="tc1",
        rationale="test",
        summary="test",
    )
    assert outcome == "rejected"


# ---------------------------------------------------------------------------
# InterruptConfirmationGate (ADR 0014 · Phase 4c)
# ---------------------------------------------------------------------------


class _State(TypedDict, total=False):
    """Minimal graph state so we can exercise the gate inside a real graph
    node that LangGraph will actually checkpoint and resume."""

    outcome: str


@pytest.mark.asyncio
async def test_interrupt_gate_raises_graph_interrupt_on_first_call(tmp_path: Path) -> None:
    """When called for the first time inside a graph node, the gate must
    call ``interrupt()`` so LangGraph pauses the graph. Without this the
    gate would fall through and the WRITE tool would run without human
    review — the entire point of the L4 Gate principle."""
    gate = InterruptConfirmationGate()
    tool = _write_tool()
    saw_decision: list[object] = []

    async def node_needing_confirmation(_state: _State) -> _State:
        outcome = await gate.request(
            tool=tool,
            args={"target": "employee-42"},
            tool_call_id="tc-1",
            rationale="scope=WRITE; requires_confirmation=True",
            summary="Delete employee-42",
        )
        saw_decision.append(outcome)
        return {"outcome": outcome}

    g = StateGraph(_State)
    g.add_node("gated", node_needing_confirmation)
    g.add_edge(START, "gated")
    g.add_edge("gated", END)

    db_path = tmp_path / "gate-phase4c-first.db"
    async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
        agent = g.compile(checkpointer=saver)
        config = {"configurable": {"thread_id": "gate-test-1"}}

        # First leg — should pause at the interrupt. No decision observed yet.
        seen_interrupt = False
        async for chunk in agent.astream({}, config=config, stream_mode=["updates"]):
            if isinstance(chunk, tuple) and len(chunk) == 2:
                mode, payload = chunk
                if mode == "updates" and "__interrupt__" in payload:
                    seen_interrupt = True

    assert seen_interrupt, "gate must call interrupt() on first invocation; graph did not pause"
    assert saw_decision == [], (
        "gate returned a decision without waiting for the user — interrupt() should have raised"
    )


@pytest.mark.asyncio
async def test_interrupt_gate_returns_approved_on_resume_with_approve(tmp_path: Path) -> None:
    """After pause, the graph is resumed with ``Command(resume="approve")``.
    The gate's request() must then return ``"approved"`` and the node must
    see that decision — without this, the tool never runs post-approval."""
    gate = InterruptConfirmationGate()
    tool = _write_tool()
    seen: list[str] = []

    async def node(_state: _State) -> _State:
        outcome = await gate.request(
            tool=tool,
            args={"target": "employee-42"},
            tool_call_id="tc-1",
            rationale="scope=WRITE",
            summary="Delete employee-42",
        )
        seen.append(outcome)
        return {"outcome": outcome}

    g = StateGraph(_State)
    g.add_node("gated", node)
    g.add_edge(START, "gated")
    g.add_edge("gated", END)

    db_path = tmp_path / "gate-phase4c-approve.db"
    async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
        agent = g.compile(checkpointer=saver)
        config = {"configurable": {"thread_id": "gate-test-2"}}

        # First leg pauses.
        async for _ in agent.astream({}, config=config, stream_mode=["updates"]):
            pass

        # Second leg resumes with "approve".
        async for _ in agent.astream(
            Command(resume="approve"),
            config=config,
            stream_mode=["updates"],
        ):
            pass

    assert seen == ["approved"], (
        f"gate must return 'approved' on resume=approve; got: {seen!r}. "
        "If this is empty, the graph did not resume; if 'rejected'/'expired', "
        "the gate's decision mapping is off."
    )


@pytest.mark.asyncio
async def test_interrupt_gate_returns_rejected_on_resume_with_reject(tmp_path: Path) -> None:
    """Symmetry with the approve case: Command(resume='reject') must map
    to the 'rejected' outcome, and the tool must NOT execute afterwards
    (which the runner's gate-wrap handles; here we just pin the mapping)."""
    gate = InterruptConfirmationGate()
    seen: list[str] = []

    async def node(_state: _State) -> _State:
        outcome = await gate.request(
            tool=_write_tool(),
            args={},
            tool_call_id="tc-1",
            rationale="",
            summary="",
        )
        seen.append(outcome)
        return {"outcome": outcome}

    g = StateGraph(_State)
    g.add_node("gated", node)
    g.add_edge(START, "gated")
    g.add_edge("gated", END)

    db_path = tmp_path / "gate-phase4c-reject.db"
    async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
        agent = g.compile(checkpointer=saver)
        config = {"configurable": {"thread_id": "gate-test-3"}}
        async for _ in agent.astream({}, config=config, stream_mode=["updates"]):
            pass
        async for _ in agent.astream(
            Command(resume="reject"),
            config=config,
            stream_mode=["updates"],
        ):
            pass

    assert seen == ["rejected"]


@pytest.mark.asyncio
async def test_interrupt_gate_interrupt_payload_carries_summary_and_rationale(
    tmp_path: Path,
) -> None:
    """The frontend prompts the user using the interrupt's ``value`` payload.
    Ensure the gate forwards summary / rationale / tool_call_id / diff so the
    dialog has everything it needs (matches the existing
    ``allhands.confirm_required`` shape so Phase 4e can swap without the UI
    losing context)."""
    gate = InterruptConfirmationGate()

    async def node(_state: _State) -> _State:
        outcome = await gate.request(
            tool=_write_tool(),
            args={"target": "employee-42"},
            tool_call_id="tc-abc",
            rationale="needs review",
            summary="Delete employee-42",
            diff={"id": "employee-42", "op": "delete"},
        )
        return {"outcome": outcome}

    g = StateGraph(_State)
    g.add_node("gated", node)
    g.add_edge(START, "gated")
    g.add_edge("gated", END)

    db_path = tmp_path / "gate-phase4c-payload.db"
    async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
        agent = g.compile(checkpointer=saver)
        config = {"configurable": {"thread_id": "gate-test-4"}}

        interrupt_value = None
        async for chunk in agent.astream({}, config=config, stream_mode=["updates"]):
            if isinstance(chunk, tuple):
                mode, payload = chunk
                if mode == "updates" and isinstance(payload, dict):
                    itrs = payload.get("__interrupt__")
                    if itrs:
                        interrupt_value = getattr(itrs[0], "value", None)

    assert isinstance(interrupt_value, dict), (
        f"expected interrupt().value to be a dict carrying gate context; saw {interrupt_value!r}"
    )
    assert interrupt_value["kind"] == "confirm_required"
    assert interrupt_value["tool_call_id"] == "tc-abc"
    assert interrupt_value["summary"] == "Delete employee-42"
    assert interrupt_value["rationale"] == "needs review"
    assert interrupt_value["diff"] == {"id": "employee-42", "op": "delete"}
