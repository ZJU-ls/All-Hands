"""Plan meta tool schema + registration tests · Round 1 redesign.

Pins the public contract of the new single-tool plan group:
  - update_plan: WRITE, atomic-replace, schema requires {todos[].content,
    todos[].activeForm, todos[].status} with three legal statuses
  - view_plan: READ, no input
"""

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
    assert by_id["allhands.meta.update_plan"].scope == ToolScope.WRITE
    assert by_id["allhands.meta.update_plan"].requires_confirmation is False
    assert by_id["allhands.meta.view_plan"].scope == ToolScope.READ
    for t in ALL_PLAN_TOOLS:
        assert t.kind == ToolKind.META
        assert t.requires_confirmation is False


def test_update_plan_schema_requires_todos() -> None:
    upd = next(t for t in ALL_PLAN_TOOLS if t.id == "allhands.meta.update_plan")
    schema = upd.input_schema
    assert "todos" in schema["required"]
    todos = schema["properties"]["todos"]
    assert todos["type"] == "array"
    assert todos["minItems"] == 1
    assert todos["maxItems"] == 20
    item = todos["items"]
    assert set(item["required"]) == {"content", "activeForm", "status"}


def test_update_plan_schema_enumerates_three_statuses() -> None:
    upd = next(t for t in ALL_PLAN_TOOLS if t.id == "allhands.meta.update_plan")
    statuses = upd.input_schema["properties"]["todos"]["items"]["properties"]["status"]["enum"]
    assert set(statuses) == {"pending", "in_progress", "completed"}


def test_view_plan_schema_takes_no_input() -> None:
    view = next(t for t in ALL_PLAN_TOOLS if t.id == "allhands.meta.view_plan")
    assert view.input_schema["properties"] == {}


def test_legacy_tool_ids_no_longer_present() -> None:
    """plan_create / plan_update_step / plan_complete_step / plan_view were
    deprecated in Round 1. Make sure ALL_PLAN_TOOLS doesn't accidentally
    re-export them from a stale alias.
    """
    ids = {t.id for t in ALL_PLAN_TOOLS}
    assert "allhands.meta.plan_create" not in ids
    assert "allhands.meta.plan_update_step" not in ids
    assert "allhands.meta.plan_complete_step" not in ids
    assert "allhands.meta.plan_view" not in ids
