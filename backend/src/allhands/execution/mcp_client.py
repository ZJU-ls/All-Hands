"""MCPClient — register MCP server tools as concrete entries in ToolRegistry.

Pre-2026-04-29 this module shipped a stdio handshake that registered each
tool as a concrete entry, but its executor closure captured the live
``ClientSession``; the surrounding ``async with stdio_client(...)`` block
exited immediately after registration, so the session was already closed
by the time any agent actually invoked the tool. On top of that, the
class was never wired into ``MCPService.add()`` — meaning the per-tool
registration code path never ran in production. The agent loop
papered over the symptom by replacing ``mcp:<server_id>`` mounts with
the universal ``list_mcp_server_tools`` + ``invoke_mcp_server_tool``
dispatch pair, which forced the LLM into a "first list, then invoke"
two-turn dance most prompts simply skip.

This rewrite follows Claude Code's MCP integration (V06):

  - Tool name = ``mcp__<server>__<tool>`` (double underscore — Anthropic
    and OpenAI both reject dots inside tool names; Claude Code uses the
    same separator).
  - Each MCP tool is a first-class ``Tool`` in the registry: real
    description + ``input_schema`` from the server's ``list_tools``
    response. The model sees concrete capabilities, not a generic
    dispatcher.
  - The executor closure captures only the *adapter*, *server*, and
    *tool name* — short-lived sessions are opened per call by
    ``RealMCPAdapter`` (already correct on the adapter side).
  - ``register_server_tools`` / ``unregister_server_tools`` are the
    only public API; ``MCPService`` calls them on add / update /
    delete / test_connection so the registry stays in sync with the DB.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from allhands.core import MCPHealth, MCPServer, Tool, ToolKind, ToolScope
from allhands.execution.mcp.adapter import MCPInvocationError

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from allhands.execution.mcp.adapter import MCPAdapter
    from allhands.execution.registry import ToolRegistry

log = logging.getLogger(__name__)


def build_mcp_tool_id(server_name: str, tool_name: str) -> str:
    """Single source of truth for the tool id format · matches Claude
    Code ``buildMcpToolName`` (V06 § 2.1).

    Double underscore separator is the only ASCII separator both
    Anthropic and OpenAI accept inside ``tool_use.name``; dots / slashes
    / colons all error out from one provider or the other.
    """
    return f"mcp__{server_name}__{tool_name}"


def parse_mcp_tool_id(tool_id: str) -> tuple[str, str] | None:
    """Inverse of ``build_mcp_tool_id``. Returns (server_name, tool_name)
    for ``mcp__a__b`` shaped ids, ``None`` for anything else."""
    if not tool_id.startswith("mcp__"):
        return None
    rest = tool_id[len("mcp__") :]
    sep = rest.find("__")
    if sep <= 0 or sep == len(rest) - 2:
        return None
    return rest[:sep], rest[sep + 2 :]


class MCPClient:
    """Bridge between persisted MCP servers and the in-process tool
    registry. Stateless — the adapter handles per-call connections."""

    def __init__(self, *, registry: ToolRegistry, adapter: MCPAdapter) -> None:
        self._registry = registry
        self._adapter = adapter
        # Track which tool ids each server contributed so unregister is
        # accurate even after a server rename. Keyed by (server.id) so
        # rename → re-register doesn't leak the old name's tools.
        self._registered_by_server: dict[str, list[str]] = {}

    async def register_server_tools(self, server: MCPServer) -> list[Tool]:
        """List the server's tools and (re-)register each one in the
        registry under its ``mcp__<name>__<tool>`` id.

        Idempotent: re-registering after a config change replaces stale
        tools — old ones whose name disappeared from the new list are
        unregistered automatically.

        Returns the list of registered ``Tool`` objects (empty when the
        server is disabled, unreachable, or has no tools).
        """
        if not server.enabled:
            await self._unregister_by_server_id(server.id)
            return []
        try:
            tools = await self._adapter.list_tools(server)
        except MCPInvocationError as exc:
            log.warning(
                "mcp.register.list_tools_failed",
                extra={
                    "server_id": server.id,
                    "server_name": server.name,
                    "error": str(exc),
                },
            )
            await self._unregister_by_server_id(server.id)
            return []

        new_ids: list[str] = []
        registered: list[Tool] = []
        for info in tools:
            tool_id = build_mcp_tool_id(server.name, info.name)
            tool = Tool(
                id=tool_id,
                kind=ToolKind.BACKEND,
                name=tool_id,
                description=info.description or f"MCP tool {info.name}",
                input_schema=info.input_schema or {"type": "object"},
                output_schema={"type": "object"},
                # MCP tools default to READ; servers that mutate state
                # advertise it through their description and the
                # confirmation gate plays no role here yet (V0).
                # Tighten per-tool when the server registry adds a
                # scope hint; until then default-safe.
                scope=ToolScope.READ,
                requires_confirmation=False,
            )
            executor = self._make_executor(server, info.name)
            self._registry.replace(tool, executor)
            new_ids.append(tool_id)
            registered.append(tool)

        # Drop tools the server no longer exposes (or any name change
        # ambiguity) — compare against the previous set for this server.
        previous = set(self._registered_by_server.get(server.id, []))
        for stale in previous - set(new_ids):
            self._registry.unregister(stale)
        self._registered_by_server[server.id] = new_ids

        log.info(
            "mcp.register.ok",
            extra={
                "server_id": server.id,
                "server_name": server.name,
                "tool_count": len(new_ids),
            },
        )
        return registered

    async def unregister_server_tools(self, server_id: str) -> None:
        """Drop every tool previously registered for ``server_id``.

        Called from MCPService.delete and from update/disable paths.
        Idempotent.
        """
        await self._unregister_by_server_id(server_id)

    def tool_ids_for_server(self, server_id: str) -> list[str]:
        """Return the concrete ``mcp__<server>__<tool>`` ids currently
        registered for ``server_id``.

        Used by ``AgentLoop._active_tool_ids`` to expand
        ``mcp:<server_id>`` employee mounts into specific tools the
        registry knows about. Empty list when the server hasn't been
        handshaken in this process (uvicorn restart, fresh worker).
        """
        return list(self._registered_by_server.get(server_id, []))

    async def _unregister_by_server_id(self, server_id: str) -> None:
        for tool_id in self._registered_by_server.pop(server_id, []):
            self._registry.unregister(tool_id)

    def _make_executor(self, server: MCPServer, tool_name: str) -> Callable[..., Awaitable[object]]:
        """Build a closure that forwards a tool_use to the MCP server.

        Captures only the adapter, server snapshot, and tool name —
        nothing session-bound, so it stays valid across server config
        edits in DB. (Call sites that need the latest server config
        re-handshake first; the broker / agent loop then sees the new
        executor anyway.)
        """
        adapter = self._adapter
        captured_server = server
        captured_name = tool_name

        async def _fn(**kwargs: object) -> object:
            try:
                return await adapter.invoke_tool(captured_server, captured_name, dict(kwargs))
            except MCPInvocationError as exc:
                # Surface as a structured error envelope so the LLM can
                # self-correct (matches the tool_arg_validation path) ·
                # the chat UI's onToolCallResult sniffs for `error` and
                # marks the chip failed.
                return {
                    "error": str(exc) or "mcp invocation failed",
                    "server": captured_server.name,
                    "tool": captured_name,
                }

        return _fn

    async def health_check(self, server: MCPServer) -> MCPHealth:
        return await self._adapter.handshake(server)


# ---------------------------------------------------------------------------
# Process-wide singleton helper.
#
# Lives at the execution layer so agent_loop / runner can resolve the
# active client without crossing the execution → api layer boundary
# (import-linter contract). The api layer (deps.py) reuses the same
# accessor so service-construction and runtime-lookup share one client.
# ---------------------------------------------------------------------------

_CLIENT: MCPClient | None = None


def get_default_mcp_client() -> MCPClient | None:
    """Return the process-wide MCPClient if it has been initialised, else
    ``None``. ``None`` means "no MCP wiring in this process" (legacy unit
    tests, isolated subagent harnesses); the loop falls back to silently
    dropping ``mcp:`` markers in that case."""
    return _CLIENT


def set_default_mcp_client(client: MCPClient | None) -> None:
    """Install (or clear) the process-wide MCPClient. Called once from
    api/deps.get_mcp_client during boot. Tests can pass a stub here to
    feed ``_active_tool_ids`` deterministic data."""
    global _CLIENT
    _CLIENT = client
