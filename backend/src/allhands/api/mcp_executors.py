"""Executor factories for MCP-server live probe / list / invoke meta tools.

Lives in ``api/`` because it closes over ``MCPService`` (services/) — the
``execution/`` layer is forbidden from importing services/ by import-linter.

Wired via ``discover_builtin_tools(..., extra_executors=...)`` in
``api/deps.py``. Without this the three tools fall through to ``_async_noop``
in ``READ_META_EXECUTORS`` and silently return ``{}`` — symptom: agent
"connects" to an MCP server but ``list_mcp_server_tools`` returns no tools
and every ``invoke_mcp_server_tool`` is a no-op. (2026-04-27 fix.)
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from allhands.execution.mcp.adapter import RealMCPAdapter
from allhands.persistence.sql_repos import SqlMCPServerRepo
from allhands.services.mcp_service import MCPService, MCPServiceError

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    ToolExecutor = Callable[..., Awaitable[Any]]


def _session_context(maker: async_sessionmaker[AsyncSession]) -> Any:
    session = maker()

    class _Ctx:
        async def __aenter__(self) -> AsyncSession:
            await session.__aenter__()
            await session.begin()
            return session

        async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
            if exc is None:
                await session.commit()
            else:
                await session.rollback()
            await session.__aexit__(exc_type, exc, tb)

    return _Ctx()


def build_mcp_invocation_executors(
    maker: async_sessionmaker[AsyncSession],
) -> dict[str, ToolExecutor]:
    """Return ``{tool_id: executor}`` for the three live-MCP meta tools.

    Adapter is a process-singleton (one ``RealMCPAdapter`` shared across
    requests) so the connection cache inside the adapter actually amortises.
    """
    adapter = RealMCPAdapter()

    def _service(session: AsyncSession) -> MCPService:
        return MCPService(repo=SqlMCPServerRepo(session), adapter=adapter)

    async def test_mcp_connection(server_id: str, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _service(session)
            updated = await svc.test_connection(server_id)
        if updated is None:
            return {
                "error": f"mcp_server {server_id!r} not found",
                "field": "server_id",
                "expected": "id of a registered MCP server (use list_mcp_servers)",
                "received": server_id,
            }
        return {
            "server_id": updated.id,
            "name": updated.name,
            "health": updated.health.value
            if hasattr(updated.health, "value")
            else str(updated.health),
            "last_handshake_at": updated.last_handshake_at.isoformat()
            if updated.last_handshake_at
            else None,
        }

    async def list_mcp_server_tools(server_id: str, **_: Any) -> dict[str, Any]:
        async with _session_context(maker) as session:
            svc = _service(session)
            try:
                tools = await svc.list_server_tools(server_id)
            except MCPServiceError as exc:
                return {
                    "error": str(exc),
                    "field": "server_id",
                    "hint": "verify the server is enabled and reachable via test_mcp_connection first",
                }
        return {
            "server_id": server_id,
            "tools": [
                {
                    "name": t.name,
                    "description": t.description,
                    "input_schema": dict(t.input_schema),
                }
                for t in tools
            ],
            "count": len(tools),
        }

    async def invoke_mcp_server_tool(
        server_id: str,
        tool_name: str,
        arguments: dict[str, Any] | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        args: dict[str, Any] = arguments or {}
        async with _session_context(maker) as session:
            svc = _service(session)
            try:
                result = await svc.invoke_server_tool(
                    server_id,
                    tool_name=tool_name,
                    arguments=args,
                )
            except MCPServiceError as exc:
                return {
                    "error": str(exc),
                    "field": "server_id|tool_name|arguments",
                    "hint": (
                        "list_mcp_server_tools first to confirm the tool name + "
                        "input schema; common cause is wrong path expansion (~ "
                        "is not expanded by all servers — pass an absolute path)"
                    ),
                }
        return {
            "server_id": server_id,
            "tool_name": tool_name,
            "result": result,
        }

    return {
        "allhands.meta.test_mcp_connection": test_mcp_connection,
        "allhands.meta.list_mcp_server_tools": list_mcp_server_tools,
        "allhands.meta.invoke_mcp_server_tool": invoke_mcp_server_tool,
    }
