"""MCPClient — connects to MCP servers and registers their tools.

v0 implementation: stdio transport only.
"""

from __future__ import annotations

import asyncio
import contextlib
from typing import TYPE_CHECKING

import structlog

from allhands.core import MCPHealth, MCPServer, MCPTransport, Tool, ToolKind, ToolScope

if TYPE_CHECKING:
    from allhands.execution.registry import ToolRegistry

log = structlog.get_logger()


class MCPClient:
    def __init__(self, registry: ToolRegistry) -> None:
        self._registry = registry
        self._connections: dict[str, object] = {}

    async def handshake(self, server: MCPServer) -> MCPHealth:
        if not server.enabled:
            return MCPHealth.UNKNOWN
        try:
            if server.transport == MCPTransport.STDIO:
                return await self._handshake_stdio(server)
            log.warning("mcp.transport.unsupported", transport=server.transport)
            return MCPHealth.UNKNOWN
        except Exception as exc:
            log.warning("mcp.handshake.failed", server=server.name, error=str(exc))
            return MCPHealth.UNREACHABLE

    async def _handshake_stdio(self, server: MCPServer) -> MCPHealth:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        config = server.config
        command = str(config.get("command", ""))
        raw_args = config.get("args", [])
        args: list[str] = list(raw_args) if isinstance(raw_args, list) else []
        raw_env = config.get("env", {})
        env: dict[str, str] = dict(raw_env) if isinstance(raw_env, dict) else {}

        params = StdioServerParameters(command=command, args=args, env=env)
        async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
            await session.initialize()
            tools_result = await session.list_tools()
            for mcp_tool in tools_result.tools:
                tool_id = f"mcp.{server.name}.{mcp_tool.name}"
                tool = Tool(
                    id=tool_id,
                    kind=ToolKind.BACKEND,
                    name=mcp_tool.name,
                    description=mcp_tool.description or f"MCP tool {mcp_tool.name}",
                    input_schema=mcp_tool.inputSchema or {"type": "object"},
                    output_schema={"type": "object"},
                    scope=ToolScope.READ,
                    requires_confirmation=False,
                )

                def _make_executor(
                    _s: object = session,
                    _n: str = mcp_tool.name,
                ) -> object:
                    async def _fn(**kwargs: object) -> object:
                        result = await _s.call_tool(_n, kwargs)  # type: ignore[attr-defined]
                        return {"result": str(result)}

                    return _fn

                executor = _make_executor()
                with contextlib.suppress(KeyError):
                    self._registry.register(tool, executor)  # type: ignore[arg-type]

        return MCPHealth.OK

    async def health_check(self, server: MCPServer) -> MCPHealth:
        try:
            return await asyncio.wait_for(self.handshake(server), timeout=5.0)
        except TimeoutError:
            return MCPHealth.UNREACHABLE
