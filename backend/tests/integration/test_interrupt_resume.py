"""ADR 0014 · Phase 3 — interrupt() → InterruptEvent → resume round trip.

End-to-end guarantee of the Phase 3 contract:
  1. A graph node that calls ``interrupt(value)`` surfaces as an
     ``InterruptEvent`` on the runner's stream — the frontend's hook point
     for showing a confirmation UI.
  2. A second ``runner.stream(..., resume={"value": <decision>})`` call
     with the same ``thread_id`` resumes the paused graph from exactly the
     interrupt point, not the start. State accumulated before the pause
     survives.

Without both of these, interrupt() would either be invisible (users can't
answer) or replay the whole graph on resume (tool side-effects run twice).

We drive a hand-built 3-node ``StateGraph`` directly through the runner's
``stream`` by mocking ``create_react_agent`` — bypassing the real agent lets
us keep the test free of LLM dependencies while exercising the real
``astream`` multi-mode + checkpointer + Command(resume) plumbing end-to-end.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

import pytest
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt
from typing_extensions import TypedDict

from allhands.core import Employee
from allhands.execution.events import InterruptEvent
from allhands.execution.gate import AutoApproveGate
from allhands.execution.registry import ToolRegistry
from allhands.execution.runner import AgentRunner


def _make_emp() -> Employee:
    return Employee(
        id="emp-itr",
        name="interrupt-test",
        description="",
        system_prompt="test-employee",
        model_ref="default",
        tool_ids=[],
        skill_ids=[],
        max_iterations=5,
        is_lead_agent=False,
        created_by="system",
        created_at=datetime.now(UTC),
        metadata={},
    )


class S(TypedDict, total=False):
    steps: list[str]
    decision: str


async def _node_a(s: S) -> S:
    return {"steps": [*list(s.get("steps", [])), "a"]}


async def _node_b(s: S) -> S:
    """Paused node: interrupt() halts the graph until Command(resume=...)."""
    decision = interrupt(
        {
            "kind": "confirm_required",
            "summary": "Execute delete_employee(id=42)",
            "rationale": "scope=WRITE; requires_confirmation=True",
        }
    )
    return {
        "steps": [*list(s.get("steps", [])), f"b:{decision}"],
        "decision": str(decision),
    }


async def _node_c(s: S) -> S:
    return {"steps": [*list(s.get("steps", [])), "c"]}


def _build_fake_graph(saver: AsyncSqliteSaver):
    g = StateGraph(S)
    g.add_node("a", _node_a)
    g.add_node("b", _node_b)
    g.add_node("c", _node_c)
    g.add_edge(START, "a")
    g.add_edge("a", "b")
    g.add_edge("b", "c")
    g.add_edge("c", END)
    return g.compile(checkpointer=saver)


@pytest.mark.asyncio
async def test_runner_yields_interrupt_event_when_graph_pauses(tmp_path: Path) -> None:
    """First half of the Phase 3 contract: a node that calls interrupt()
    produces an InterruptEvent on the runner stream, with id + value
    preserved so the frontend has everything it needs to prompt the human."""
    db_path = tmp_path / "itr-1.db"
    async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
        graph = _build_fake_graph(saver)
        runner = AgentRunner(
            employee=_make_emp(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
            checkpointer=saver,
        )
        thread_id = "conv-itr-1"

        # Bypass the real create_react_agent — we want to steer the
        # streaming-mode / Command resume plumbing through a graph we own
        # that is guaranteed to call interrupt(). _build_model is also
        # patched so the runner doesn't try to reach a real provider.
        with (
            patch("allhands.execution.runner._build_model", return_value=object()),
            patch(
                "langgraph.prebuilt.create_react_agent",
                return_value=graph,
            ),
        ):
            events = [
                e
                async for e in runner.stream(
                    messages=[{"role": "user", "content": "kick off"}],
                    thread_id=thread_id,
                )
            ]

        interrupts = [e for e in events if isinstance(e, InterruptEvent)]
        assert len(interrupts) == 1, (
            f"expected exactly one InterruptEvent, saw kinds: {[e.kind for e in events]!r}"
        )
        itr = interrupts[0]
        assert itr.value["kind"] == "confirm_required"
        assert itr.value["summary"] == "Execute delete_employee(id=42)"
        assert itr.interrupt_id, "LangGraph interrupt id must be forwarded for resume matching"


@pytest.mark.asyncio
async def test_runner_resume_continues_from_interrupt_point(tmp_path: Path) -> None:
    """Second half: after the pause, invoking runner.stream(..., resume=...)
    with the same thread_id picks up from the interrupt point — node A (pre-
    pause) runs exactly once across the full round trip, and node C (post-
    pause) receives the resume value by way of node B's return."""
    db_path = tmp_path / "itr-2.db"
    async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
        graph = _build_fake_graph(saver)
        runner = AgentRunner(
            employee=_make_emp(),
            tool_registry=ToolRegistry(),
            gate=AutoApproveGate(),
            checkpointer=saver,
        )
        thread_id = "conv-itr-2"

        with (
            patch("allhands.execution.runner._build_model", return_value=object()),
            patch(
                "langgraph.prebuilt.create_react_agent",
                return_value=graph,
            ),
        ):
            # First leg — should pause at node b.
            first = [
                e
                async for e in runner.stream(
                    messages=[{"role": "user", "content": "kick off"}],
                    thread_id=thread_id,
                )
            ]
            assert any(e.kind == "interrupt_required" for e in first), (
                "first leg must yield an interrupt_required event"
            )

            # Second leg — resume with the decision. Messages are ignored
            # because resume=... is set.
            second = [
                e
                async for e in runner.stream(
                    messages=[],
                    thread_id=thread_id,
                    resume={"value": "approve"},
                )
            ]
            # Second leg must not emit another interrupt for the same pause;
            # it should complete.
            assert not any(e.kind == "interrupt_required" for e in second), (
                "resume leg must not re-surface the interrupt — it was answered"
            )
            assert second[-1].kind == "done", (
                f"resume leg must close with DoneEvent; saw: {[e.kind for e in second]}"
            )

        # Inspect persisted graph state: node A ran once, B captured the
        # decision, C ran once. No duplication from replay.
        snap = await saver.aget_tuple({"configurable": {"thread_id": thread_id}})
        assert snap is not None
        final_state = snap.checkpoint["channel_values"]
        assert final_state["steps"] == ["a", "b:approve", "c"], (
            "Graph must replay exactly once per node across the pause — "
            f"got: {final_state.get('steps')!r}"
        )
        assert final_state["decision"] == "approve", "Resume value must flow into node B's state"
