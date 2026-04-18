"""Plan meta tool schema + registration tests."""

from __future__ import annotations

from allhands.core import ToolKind, ToolScope
from allhands.execution.registry import ToolRegistry
from allhands.execution.tools import discover_builtin_tools
from allhands.execution.tools.meta.plan_tools import ALL_PLAN_TOOLS


def test_plan_tools_registered() -> None:
    reg = ToolRegistry()
    discover_builtin_tools(reg)
    for tool in ALL_PLAN_TOOLS:
        assert reg.get(tool.id) is not None, f"{tool.id} not registered"


def test_plan_tools_metadata() -> None:
    by_id = {t.id: t for t in ALL_PLAN_TOOLS}
    assert by_id["allhands.meta.plan_create"].scope == ToolScope.WRITE
    assert by_id["allhands.meta.plan_create"].requires_confirmation is False
    assert by_id["allhands.meta.plan_view"].scope == ToolScope.READ
    for t in ALL_PLAN_TOOLS:
        assert t.kind == ToolKind.META
        assert t.requires_confirmation is False


def test_plan_create_schema_requires_title_and_steps() -> None:
    create = next(t for t in ALL_PLAN_TOOLS if t.id == "allhands.meta.plan_create")
    schema = create.input_schema
    assert "title" in schema["required"]
    assert "steps" in schema["required"]
    steps = schema["properties"]["steps"]
    assert steps["type"] == "array"
    assert steps["maxItems"] == 20
    assert steps["minItems"] == 1


def test_plan_update_step_schema_enumerates_statuses() -> None:
    upd = next(t for t in ALL_PLAN_TOOLS if t.id == "allhands.meta.plan_update_step")
    statuses = upd.input_schema["properties"]["status"]["enum"]
    assert set(statuses) == {"pending", "running", "done", "skipped", "failed"}
