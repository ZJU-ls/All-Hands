"""ToolRegistry — unified registration for Backend / Render / Meta tools."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from allhands.core import Tool

ToolExecutor = Callable[..., Awaitable[Any]]


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}
        self._executors: dict[str, ToolExecutor] = {}

    def register(self, tool: Tool, executor: ToolExecutor) -> None:
        if tool.id in self._tools:
            raise KeyError(f"Tool '{tool.id}' is already registered.")
        self._tools[tool.id] = tool
        self._executors[tool.id] = executor

    def replace(self, tool: Tool, executor: ToolExecutor) -> None:
        """Like ``register`` but allows overwriting an existing entry.

        Used by MCP server registration: when a server is updated and
        re-handshaken, its tool list may have changed; we want fresh
        Schemas + executors instead of stale ones from the previous
        connection. Plain ``register`` would raise KeyError because the
        ids match.
        """
        self._tools[tool.id] = tool
        self._executors[tool.id] = executor

    def unregister(self, tool_id: str) -> None:
        """Remove a tool from the registry. Idempotent — missing ids are
        a no-op so callers can blindly clean up after server delete."""
        self._tools.pop(tool_id, None)
        self._executors.pop(tool_id, None)

    def get(self, tool_id: str) -> tuple[Tool, ToolExecutor]:
        if tool_id not in self._tools:
            raise KeyError(f"Tool '{tool_id}' not found in registry.")
        return self._tools[tool_id], self._executors[tool_id]

    def list_by_ids(self, tool_ids: list[str]) -> list[Tool]:
        return [self._tools[tid] for tid in tool_ids if tid in self._tools]

    def list_all(self) -> list[Tool]:
        return list(self._tools.values())

    def tool_ids_with_prefix(self, prefix: str) -> list[str]:
        """List all registered tool ids that start with ``prefix``.

        Used by AgentLoop to expand ``mcp:<server_id>`` employee mounts
        into the concrete ``mcp__<server>__<tool>`` ids that were
        registered at server-handshake time. Stable order = registration
        order (Python 3.7+ dict insertion order).
        """
        return [tid for tid in self._tools if tid.startswith(prefix)]
