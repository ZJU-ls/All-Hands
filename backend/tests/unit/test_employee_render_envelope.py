"""Unit tests for the EmployeeCard render envelope wrapper (I-0008).

Contract:
- ``build_employee_card_render`` emits the ``{component, props, interactions}``
  shape with component name ``EmployeeCard`` (matching web/lib/component-registry.ts).
- ``execute_create_employee`` is wired as the runtime executor for
  ``allhands.meta.create_employee``. Calling it returns the same envelope so
  Lead's chat renders the new employee inline.
- Unknown / missing status falls back to ``draft`` (not ``None``).
- ``model_ref`` ``"provider/name"`` splits into ``{provider, name}`` for the card.
"""

from __future__ import annotations

import pytest

from allhands.execution.registry import ToolRegistry
from allhands.execution.tools import discover_builtin_tools
from allhands.execution.tools.meta.employee_tools import (
    CREATE_EMPLOYEE_TOOL,
    build_employee_card_render,
    execute_create_employee,
)


def test_envelope_shape_matches_render_contract() -> None:
    env = build_employee_card_render(
        employee_id="emp-1",
        name="Researcher",
        role="desk research",
        system_prompt_preview="你是一名擅长桌面研究的助手",
        skill_count=2,
        tool_count=7,
        model_ref="openai/gpt-4o-mini",
        status="active",
    )
    assert env["component"] == "EmployeeCard"
    assert env["interactions"] == []
    props = env["props"]
    assert props["employee_id"] == "emp-1"
    assert props["name"] == "Researcher"
    assert props["role"] == "desk research"
    assert props["skill_count"] == 2
    assert props["tool_count"] == 7
    assert props["model"] == {"provider": "openai", "name": "gpt-4o-mini"}
    assert props["status"] == "active"


def test_unknown_status_falls_back_to_draft() -> None:
    env = build_employee_card_render(
        employee_id="emp-2",
        name="A",
        status="bogus",
    )
    assert env["props"]["status"] == "draft"


def test_long_system_prompt_is_truncated() -> None:
    env = build_employee_card_render(
        employee_id="emp-3",
        name="Writer",
        system_prompt_preview="x" * 1000,
    )
    preview = env["props"]["system_prompt_preview"]
    # 240 char cap with an ellipsis marker.
    assert len(preview) <= 240
    assert preview.endswith("…")


def test_empty_optional_fields_are_omitted() -> None:
    env = build_employee_card_render(
        employee_id="emp-4",
        name="Bare",
    )
    props = env["props"]
    # Only the required trio + status default are present; no None stragglers.
    assert set(props.keys()) == {"employee_id", "name", "status"}
    assert props["status"] == "draft"


def test_model_ref_without_slash_becomes_custom_provider() -> None:
    env = build_employee_card_render(
        employee_id="emp-5",
        name="Local",
        model_ref="llama3",
    )
    assert env["props"]["model"] == {"provider": "custom", "name": "llama3"}


async def test_execute_create_employee_returns_envelope() -> None:
    env = await execute_create_employee(
        name="Lead",
        description="The coordinator",
        system_prompt="You are the Lead agent.",
        model_ref="openai/gpt-4o",
        tool_ids=["allhands.meta.list_employees"],
        skill_ids=["allhands.render"],
        max_iterations=12,
    )
    assert env["component"] == "EmployeeCard"
    assert env["props"]["name"] == "Lead"
    assert env["props"]["tool_count"] == 1
    assert env["props"]["skill_count"] == 1
    assert env["props"]["model"] == {"provider": "openai", "name": "gpt-4o"}
    assert env["props"]["status"] == "draft"
    assert "Lead" in env["props"]["employee_id"]


def test_registry_wires_create_employee_executor() -> None:
    """discover_builtin_tools must bind execute_create_employee, not the no-op."""
    registry = ToolRegistry()
    discover_builtin_tools(registry)
    tool, executor = registry.get(CREATE_EMPLOYEE_TOOL.id)
    assert tool.id == "allhands.meta.create_employee"
    assert executor is execute_create_employee


async def test_registered_executor_roundtrip() -> None:
    registry = ToolRegistry()
    discover_builtin_tools(registry)
    _, executor = registry.get(CREATE_EMPLOYEE_TOOL.id)
    env = await executor(
        name="Researcher",
        description="Reads docs",
        system_prompt="Cite sources.",
        model_ref="deepseek/deepseek-chat",
    )
    assert env["component"] == "EmployeeCard"
    assert env["props"]["model"]["name"] == "deepseek-chat"


def test_envelope_passes_pydantic_schema_parity() -> None:
    """The envelope must validate against api.protocol.EmployeeCardProps.

    api/protocol.py is the canonical Pydantic contract that mirrors
    web/lib/protocol.ts. This parity check guards against drift.
    """
    from allhands.api.protocol import EmployeeCardProps

    env = build_employee_card_render(
        employee_id="emp-6",
        name="Writer",
        role="drafts",
        system_prompt_preview="please be concise",
        skill_count=1,
        tool_count=2,
        model_ref="openai/gpt-4o",
        status="active",
    )
    model = EmployeeCardProps.model_validate(env["props"])
    assert model.employee_id == "emp-6"
    assert model.model is not None
    assert model.model.provider == "openai"


@pytest.mark.parametrize("status", ["draft", "active", "paused"])
def test_all_valid_statuses_pass_through(status: str) -> None:
    env = build_employee_card_render(
        employee_id=f"emp-{status}",
        name=f"E-{status}",
        status=status,
    )
    assert env["props"]["status"] == status
