"""Smoke tests for core/ domain models. Locks the invariants spelled out in the spec."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from allhands.core import (
    Confirmation,
    ConfirmationStatus,
    Conversation,
    CostHint,
    Employee,
    MCPServer,
    MCPTransport,
    Message,
    RenderPayload,
    Skill,
    Tool,
    ToolCall,
    ToolCallStatus,
    ToolKind,
    ToolScope,
)
from allhands.core.employee import is_valid_employee_name


def _now() -> datetime:
    return datetime.now(UTC)


def test_tool_is_frozen_and_serializable() -> None:
    tool = Tool(
        id="allhands.builtin.echo",
        kind=ToolKind.BACKEND,
        name="echo",
        description="Return input verbatim.",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        scope=ToolScope.READ,
        requires_confirmation=False,
        cost_hint=CostHint(relative="low"),
    )
    assert tool.scope == ToolScope.READ
    dumped = tool.model_dump()
    assert dumped["id"] == "allhands.builtin.echo"


def test_skill_round_trip() -> None:
    skill = Skill(
        id="sk_research",
        name="research",
        description="Gather info from web + notes.",
        tool_ids=["allhands.builtin.fetch_url"],
        prompt_fragment="You are thorough.",
        version="0.1.0",
    )
    assert skill.tool_ids == ["allhands.builtin.fetch_url"]


def test_mcp_server_defaults() -> None:
    mcp = MCPServer(id="m1", name="notes", transport=MCPTransport.STDIO, config={})
    assert mcp.enabled is True
    assert mcp.health == "unknown"


def test_employee_name_accepts_display_names() -> None:
    """B01: name 是用户可见的展示名,允许 CJK / 空格 / emoji / 数字打头。"""
    assert is_valid_employee_name("Researcher")
    assert is_valid_employee_name("技能测试员")
    assert is_valid_employee_name("研究员 Alpha")
    assert is_valid_employee_name("🧠 thinker")
    assert is_valid_employee_name("1st analyst")
    assert is_valid_employee_name("has space")


def test_employee_name_rejects_edge_cases() -> None:
    """B01: 仍需拒绝空串 / 前后空格 / 控制字符 / 过长。"""
    assert not is_valid_employee_name("")
    assert not is_valid_employee_name("  ")
    assert not is_valid_employee_name(" leading")
    assert not is_valid_employee_name("trailing ")
    assert not is_valid_employee_name("a\x00b")
    assert not is_valid_employee_name("x" * 65)


def test_employee_rejects_reserved_role_name() -> None:
    with pytest.raises(ValidationError):
        Employee(
            id="e1",
            name="system",
            description="",
            system_prompt="x",
            model_ref="openai/gpt-4o-mini",
            created_by="user",
            created_at=_now(),
        )


def test_employee_has_no_mode_field() -> None:
    """ADR 0004: unified React Agent. The model must not expose a 'mode' field."""
    assert "mode" not in Employee.model_fields


def test_employee_has_any_capability() -> None:
    base = {
        "id": "e1",
        "name": "Researcher",
        "description": "",
        "system_prompt": "x",
        "model_ref": "openai/gpt-4o-mini",
        "created_by": "user",
        "created_at": _now(),
    }
    assert not Employee(**base).has_any_capability()
    assert Employee(**base, tool_ids=["t1"]).has_any_capability()
    assert Employee(**base, skill_ids=["s1"]).has_any_capability()


def test_employee_max_iterations_bounds() -> None:
    base = {
        "id": "e1",
        "name": "Researcher",
        "description": "",
        "system_prompt": "x",
        "model_ref": "openai/gpt-4o-mini",
        "created_by": "user",
        "created_at": _now(),
    }
    with pytest.raises(ValidationError):
        Employee(**base, max_iterations=0)
    with pytest.raises(ValidationError):
        Employee(**base, max_iterations=101)


def test_message_with_tool_calls() -> None:
    tool_call = ToolCall(
        id="tc_1",
        tool_id="allhands.builtin.echo",
        args={"x": 1},
        status=ToolCallStatus.PENDING,
    )
    msg = Message(
        id="m1",
        conversation_id="c1",
        role="assistant",
        content="calling tool",
        tool_calls=[tool_call],
        created_at=_now(),
    )
    assert msg.tool_calls[0].status == ToolCallStatus.PENDING


def test_render_payload_minimal() -> None:
    rp = RenderPayload(component="Card", props={"title": "x"})
    assert rp.interactions == []


def test_conversation_minimum_fields() -> None:
    c = Conversation(id="c1", employee_id="e1", created_at=_now())
    assert c.title is None


def test_confirmation_expiry_shape() -> None:
    now = _now()
    c = Confirmation(
        id="cf1",
        tool_call_id="tc1",
        rationale="why",
        summary="summary",
        status=ConfirmationStatus.PENDING,
        created_at=now,
        expires_at=now + timedelta(minutes=5),
    )
    assert c.resolved_at is None
    assert c.status == ConfirmationStatus.PENDING
