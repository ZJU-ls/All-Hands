"""Tests for ToolRegistry and builtin tools."""

from __future__ import annotations

import pytest

from allhands.core import Tool, ToolKind, ToolScope
from allhands.execution.registry import ToolRegistry
from allhands.execution.tools import discover_builtin_tools


def test_registry_register_and_get() -> None:
    registry = ToolRegistry()
    tool = Tool(
        id="test.echo",
        kind=ToolKind.BACKEND,
        name="echo",
        description="echo",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        scope=ToolScope.READ,
    )

    async def executor(**kwargs: object) -> str:
        return "ok"

    registry.register(tool, executor)
    t, ex = registry.get("test.echo")
    assert t.id == "test.echo"
    assert ex is executor


def test_registry_duplicate_raises() -> None:
    registry = ToolRegistry()
    tool = Tool(
        id="test.dup",
        kind=ToolKind.BACKEND,
        name="dup",
        description="dup",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        scope=ToolScope.READ,
    )

    async def executor(**kwargs: object) -> str:
        return "ok"

    registry.register(tool, executor)
    with pytest.raises(KeyError):
        registry.register(tool, executor)


def test_registry_get_missing_raises() -> None:
    registry = ToolRegistry()
    with pytest.raises(KeyError):
        registry.get("nonexistent")


def test_registry_list_by_ids() -> None:
    registry = ToolRegistry()
    tool = Tool(
        id="test.a",
        kind=ToolKind.BACKEND,
        name="a",
        description="a",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        scope=ToolScope.READ,
    )

    async def executor(**kwargs: object) -> str:
        return "ok"

    registry.register(tool, executor)
    tools = registry.list_by_ids(["test.a", "nonexistent"])
    assert len(tools) == 1
    assert tools[0].id == "test.a"


def test_discover_builtin_tools_returns_expected_ids() -> None:
    registry = ToolRegistry()
    discover_builtin_tools(registry)
    ids = {t.id for t in registry.list_all()}
    assert "allhands.builtin.fetch_url" in ids
    assert "allhands.builtin.write_file" in ids
    assert "allhands.render.markdown_card" in ids
    assert "allhands.meta.create_employee" in ids


def test_fetch_url_tool_requires_no_confirmation() -> None:
    registry = ToolRegistry()
    discover_builtin_tools(registry)
    tool, _ = registry.get("allhands.builtin.fetch_url")
    assert tool.requires_confirmation is False
    assert tool.scope == ToolScope.READ


def test_write_file_tool_requires_confirmation() -> None:
    registry = ToolRegistry()
    discover_builtin_tools(registry)
    tool, _ = registry.get("allhands.builtin.write_file")
    assert tool.requires_confirmation is True
    assert tool.scope == ToolScope.WRITE
