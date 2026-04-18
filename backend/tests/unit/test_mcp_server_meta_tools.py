"""Task 3 · MCP server Meta Tool contract tests.

Mirrors what tests/unit/test_skill_meta_tools.py does for skills:
validates shape + confirmation gating + L01 registration.
"""

from __future__ import annotations

from allhands.core import ToolKind, ToolScope
from allhands.execution.registry import ToolRegistry
from allhands.execution.tools import discover_builtin_tools
from allhands.execution.tools.meta.mcp_server_tools import (
    ADD_MCP_SERVER_TOOL,
    ALL_MCP_SERVER_META_TOOLS,
    DELETE_MCP_SERVER_TOOL,
    GET_MCP_SERVER_TOOL,
    INVOKE_MCP_SERVER_TOOL_TOOL,
    LIST_MCP_SERVER_TOOLS_TOOL,
    LIST_MCP_SERVERS_TOOL,
    TEST_MCP_CONNECTION_TOOL,
    UPDATE_MCP_SERVER_TOOL,
)


def test_all_mcp_meta_tools_have_required_ids() -> None:
    ids = {t.id for t in ALL_MCP_SERVER_META_TOOLS}
    assert "allhands.meta.list_mcp_servers" in ids
    assert "allhands.meta.get_mcp_server" in ids
    assert "allhands.meta.add_mcp_server" in ids
    assert "allhands.meta.update_mcp_server" in ids
    assert "allhands.meta.delete_mcp_server" in ids
    assert "allhands.meta.test_mcp_connection" in ids
    assert "allhands.meta.list_mcp_server_tools" in ids
    assert "allhands.meta.invoke_mcp_server_tool" in ids


def test_all_mcp_meta_tools_are_meta_kind() -> None:
    for tool in ALL_MCP_SERVER_META_TOOLS:
        assert tool.kind == ToolKind.META, f"{tool.id} is not META"


def test_write_and_irreversible_tools_require_confirmation() -> None:
    for tool in ALL_MCP_SERVER_META_TOOLS:
        if tool.scope in {ToolScope.WRITE, ToolScope.IRREVERSIBLE}:
            assert tool.requires_confirmation is True, (
                f"{tool.id} ({tool.scope}) must require confirmation"
            )


def test_read_tools_do_not_require_confirmation() -> None:
    read_tools = [t for t in ALL_MCP_SERVER_META_TOOLS if t.scope == ToolScope.READ]
    for tool in read_tools:
        assert tool.requires_confirmation is False, (
            f"READ tool {tool.id} should not need confirmation"
        )


def test_delete_is_irreversible() -> None:
    assert DELETE_MCP_SERVER_TOOL.scope == ToolScope.IRREVERSIBLE


def test_invoke_tool_is_write_and_requires_confirmation() -> None:
    """MCP tool invocation = external side effect → WRITE + confirm."""
    assert INVOKE_MCP_SERVER_TOOL_TOOL.scope == ToolScope.WRITE
    assert INVOKE_MCP_SERVER_TOOL_TOOL.requires_confirmation is True


def test_add_tool_requires_name_transport_config() -> None:
    schema = ADD_MCP_SERVER_TOOL.input_schema
    required = set(schema.get("required", []))
    assert {"name", "transport", "config"}.issubset(required)


def test_invoke_tool_requires_server_id_tool_name_args() -> None:
    schema = INVOKE_MCP_SERVER_TOOL_TOOL.input_schema
    required = set(schema.get("required", []))
    assert {"server_id", "tool_name"}.issubset(required)


def test_server_id_only_read_tools_shape() -> None:
    """get / test_connection / list_server_tools take just server_id."""
    for tool in (GET_MCP_SERVER_TOOL, TEST_MCP_CONNECTION_TOOL, LIST_MCP_SERVER_TOOLS_TOOL):
        required = set(tool.input_schema.get("required", []))
        assert required == {"server_id"}, f"{tool.id} required != {{server_id}}"


def test_list_servers_requires_no_input() -> None:
    schema = LIST_MCP_SERVERS_TOOL.input_schema
    assert schema.get("required", []) == []


def test_update_tool_requires_server_id() -> None:
    schema = UPDATE_MCP_SERVER_TOOL.input_schema
    assert "server_id" in set(schema.get("required", []))


def test_discover_registers_mcp_meta_tools() -> None:
    reg = ToolRegistry()
    discover_builtin_tools(reg)
    for tool in ALL_MCP_SERVER_META_TOOLS:
        assert reg.get(tool.id) is not None, f"{tool.id} not in registry"
