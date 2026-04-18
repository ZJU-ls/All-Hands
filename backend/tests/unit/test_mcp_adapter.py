"""MCP on-demand adapter contract tests.

Task 3 · independent of execution/mcp_client.py (which is the startup-time
registry-populator). This adapter is for UI probing / Lead Agent invocation —
per-call handshake, list_tools, invoke_tool.

Real adapter against live MCP servers is smoke-only (would need child processes
or live HTTP endpoints). Here we verify:
- Protocol shape / dataclasses
- unknown transport errors cleanly
- stdio with a bogus command → UNREACHABLE (not raising)
"""

from __future__ import annotations

import pytest

from allhands.core import MCPHealth, MCPServer, MCPTransport
from allhands.execution.mcp.adapter import (
    MCPAdapter,
    MCPInvocationError,
    MCPToolInfo,
    RealMCPAdapter,
)


def _stdio_server(command: str = "nonexistent-binary-xyz") -> MCPServer:
    return MCPServer(
        id="srv-test",
        name="test",
        transport=MCPTransport.STDIO,
        config={"command": command, "args": [], "env": {}},
    )


def test_mcp_tool_info_fields() -> None:
    info = MCPToolInfo(name="echo", description="echo a message", input_schema={"type": "object"})
    assert info.name == "echo"
    assert info.description == "echo a message"
    assert info.input_schema == {"type": "object"}


def test_adapter_is_protocol() -> None:
    """Protocol is runtime_checkable so services can type-check the slot."""
    adapter = RealMCPAdapter()
    assert isinstance(adapter, MCPAdapter)


@pytest.mark.asyncio
async def test_stdio_handshake_bogus_command_returns_unreachable() -> None:
    adapter = RealMCPAdapter(timeout_s=1.0)
    server = _stdio_server()
    health = await adapter.handshake(server)
    assert health == MCPHealth.UNREACHABLE


@pytest.mark.asyncio
async def test_stdio_list_tools_bogus_command_raises() -> None:
    adapter = RealMCPAdapter(timeout_s=1.0)
    server = _stdio_server()
    with pytest.raises(MCPInvocationError):
        await adapter.list_tools(server)


@pytest.mark.asyncio
async def test_stdio_invoke_tool_bogus_command_raises() -> None:
    adapter = RealMCPAdapter(timeout_s=1.0)
    server = _stdio_server()
    with pytest.raises(MCPInvocationError):
        await adapter.invoke_tool(server, "echo", {})


@pytest.mark.asyncio
async def test_handshake_respects_enabled_false() -> None:
    adapter = RealMCPAdapter(timeout_s=1.0)
    server = _stdio_server().model_copy(update={"enabled": False})
    health = await adapter.handshake(server)
    assert health == MCPHealth.UNKNOWN
