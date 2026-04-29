"""MCPService — backend for `/mcp-servers` UI and MCP Meta Tools.

Single business-logic layer over `MCPServerRepo` + `MCPAdapter`. Handles:
- CRUD on registered servers
- live probing (`test_connection`) — calls handshake, persists health + timestamp
- live `list_server_tools` / `invoke_server_tool` for Lead Agent and UI

Raises `MCPServiceError` for duplicates / missing servers / adapter failures;
routers translate to 400/404.
"""

from __future__ import annotations

import contextlib
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from allhands.core import MCPHealth, MCPServer, MCPTransport
from allhands.execution.mcp.adapter import MCPInvocationError

if TYPE_CHECKING:
    from allhands.execution.mcp.adapter import MCPAdapter, MCPToolInfo
    from allhands.execution.mcp_client import MCPClient
    from allhands.persistence.repositories import MCPServerRepo


class MCPServiceError(Exception):
    """Business-layer error: duplicate name, missing server, or adapter failure."""


class MCPService:
    def __init__(
        self,
        *,
        repo: MCPServerRepo,
        adapter: MCPAdapter,
        client: MCPClient | None = None,
    ) -> None:
        self._repo = repo
        self._adapter = adapter
        # The bridge into ToolRegistry. Optional so legacy test
        # constructions (single-router unit tests) keep working without
        # spinning up a registry; production wiring (api/deps.py) always
        # passes one so add/test/update/delete keep the registry in sync
        # with the DB.
        self._client = client

    async def list_all(self) -> list[MCPServer]:
        return await self._repo.list_all()

    async def get(self, server_id: str) -> MCPServer | None:
        return await self._repo.get(server_id)

    async def add(
        self,
        *,
        name: str,
        transport: MCPTransport,
        config: dict[str, object],
        enabled: bool = True,
    ) -> MCPServer:
        if not name.strip():
            raise MCPServiceError("name must not be empty")
        existing = await self._repo.list_all()
        if any(s.name == name for s in existing):
            raise MCPServiceError(f"server with name {name!r} already exists")
        server = MCPServer(
            id=str(uuid.uuid4()),
            name=name,
            transport=transport,
            config=dict(config),
            enabled=enabled,
            exposed_tool_ids=[],
            last_handshake_at=None,
            health=MCPHealth.UNKNOWN,
        )
        await self._repo.upsert(server)
        # Best-effort: probe + cache the tool catalogue right after add when
        # enabled. Failure is non-fatal — the row is already saved and the
        # user can hit "test" later. Without this, freshly added servers
        # show "0 tools" until the user manually tests. test_connection
        # additionally registers each tool into the in-process ToolRegistry
        # via MCPClient (2026-04-29 fix · concrete tools, not dispatcher).
        if enabled:
            probed = await self.test_connection(server.id)
            if probed is not None:
                return probed
        return server

    async def update(
        self,
        server_id: str,
        *,
        name: str | None = None,
        config: dict[str, object] | None = None,
        enabled: bool | None = None,
    ) -> MCPServer | None:
        current = await self._repo.get(server_id)
        if current is None:
            return None
        if name is not None and name != current.name:
            other = await self._repo.list_all()
            if any(s.name == name and s.id != server_id for s in other):
                raise MCPServiceError(f"server with name {name!r} already exists")
        updated = current.model_copy(
            update={
                "name": name if name is not None else current.name,
                "config": dict(config) if config is not None else current.config,
                "enabled": enabled if enabled is not None else current.enabled,
            }
        )
        await self._repo.upsert(updated)
        # Re-handshake to pick up new config (e.g. command path changed)
        # and refresh the in-process tool registry. Disabled servers get
        # their tools unregistered on the next test_connection.
        if self._client is not None and updated.enabled:
            # best-effort · UI test button will surface errors
            with contextlib.suppress(Exception):
                await self._client.register_server_tools(updated)
        elif self._client is not None and not updated.enabled:
            await self._client.unregister_server_tools(updated.id)
        return updated

    async def delete(self, server_id: str) -> None:
        if self._client is not None:
            await self._client.unregister_server_tools(server_id)
        await self._repo.delete(server_id)

    async def test_connection(self, server_id: str) -> MCPServer | None:
        """Probe the server + refresh the cached tool catalogue.

        Pre-2026-04-28 this only updated ``health`` + ``last_handshake_at`` ·
        ``exposed_tool_ids`` was initialised to ``[]`` at ``add()`` time and
        **never refreshed**, so the UI's "tool count" chip was permanently
        stuck at 0 even when ``list_server_tools`` returned a full catalogue.
        Now: on a healthy handshake we list tools in the same call and
        persist their names to ``exposed_tool_ids`` — single click fixes
        the count, no extra plumbing.
        """
        server = await self._repo.get(server_id)
        if server is None:
            return None
        new_tool_ids: list[str] = list(server.exposed_tool_ids)
        try:
            health = await self._adapter.handshake(server)
        except MCPInvocationError:
            health = MCPHealth.UNREACHABLE
        if health == MCPHealth.OK:
            try:
                tools = await self._adapter.list_tools(server)
                new_tool_ids = [t.name for t in tools]
            except MCPInvocationError:
                # Handshake passed but list_tools failed — leave the cached
                # ids untouched rather than zeroing them. The UI will still
                # show last-known count and the user can retry.
                pass
        updated = server.model_copy(
            update={
                "health": health,
                "last_handshake_at": datetime.now(UTC),
                "exposed_tool_ids": new_tool_ids,
            },
        )
        await self._repo.upsert(updated)
        # Mirror the catalogue into ToolRegistry as concrete
        # ``mcp__<server>__<tool>`` entries so the agent loop can expand
        # ``mcp:<server_id>`` mounts to specific Tools (rather than
        # falling back on the universal dispatcher pair). Best-effort:
        # an MCPInvocationError here just means the next agent turn will
        # see fewer tools, not that the test_connection failed.
        if self._client is not None and health == MCPHealth.OK:
            with contextlib.suppress(Exception):
                await self._client.register_server_tools(updated)
        elif self._client is not None and health != MCPHealth.OK:
            await self._client.unregister_server_tools(updated.id)
        return updated

    async def list_server_tools(self, server_id: str) -> list[MCPToolInfo]:
        server = await self._repo.get(server_id)
        if server is None:
            raise MCPServiceError(f"server {server_id!r} not found")
        try:
            return await self._adapter.list_tools(server)
        except MCPInvocationError as exc:
            raise MCPServiceError(str(exc)) from exc

    async def invoke_server_tool(
        self,
        server_id: str,
        *,
        tool_name: str,
        arguments: dict[str, object],
    ) -> dict[str, object]:
        server = await self._repo.get(server_id)
        if server is None:
            raise MCPServiceError(f"server {server_id!r} not found")
        try:
            return await self._adapter.invoke_tool(server, tool_name, arguments)
        except MCPInvocationError as exc:
            raise MCPServiceError(str(exc)) from exc
