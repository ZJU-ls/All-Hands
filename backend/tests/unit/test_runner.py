"""Tests for AgentRunner — uses a patched LLM to avoid real API calls."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock, patch

from allhands.core import Employee
from allhands.execution.gate import AutoApproveGate
from allhands.execution.registry import ToolRegistry
from allhands.execution.runner import AgentRunner


def _make_employee() -> Employee:
    return Employee(
        id="e1",
        name="TestEmployee",
        description="test",
        system_prompt="You are helpful.",
        model_ref="openai/gpt-4o-mini",
        tool_ids=[],
        created_by="user",
        created_at=datetime.now(UTC),
    )


async def test_runner_yields_done_event() -> None:
    """Runner must yield at least a DoneEvent on completion."""
    tool_registry = ToolRegistry()
    gate = AutoApproveGate()
    employee = _make_employee()

    from langchain_core.messages import AIMessage  # type: ignore[import]

    mock_agent = MagicMock()

    async def fake_astream(*args: Any, **kwargs: Any) -> AsyncIterator[Any]:
        yield {"messages": [AIMessage(content="Hello!")]}

    mock_agent.astream = fake_astream

    with (
        patch("langgraph.prebuilt.create_react_agent", return_value=mock_agent),
        patch("allhands.execution.runner._build_model", return_value=MagicMock()),
    ):
        runner = AgentRunner(
            employee=employee,
            tool_registry=tool_registry,
            gate=gate,
        )
        events = []
        async for event in runner.stream(
            messages=[{"role": "user", "content": "hi"}],
            thread_id="t1",
        ):
            events.append(event)

    kinds = {e.kind for e in events}
    assert "done" in kinds
