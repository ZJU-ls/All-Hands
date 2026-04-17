"""Tests for ConfirmationGate policies."""

from __future__ import annotations

import pytest

from allhands.core import Tool, ToolKind, ToolScope
from allhands.execution.gate import AutoApproveGate, AutoRejectGate


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
