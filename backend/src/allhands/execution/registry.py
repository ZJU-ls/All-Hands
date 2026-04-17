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

    def get(self, tool_id: str) -> tuple[Tool, ToolExecutor]:
        if tool_id not in self._tools:
            raise KeyError(f"Tool '{tool_id}' not found in registry.")
        return self._tools[tool_id], self._executors[tool_id]

    def list_by_ids(self, tool_ids: list[str]) -> list[Tool]:
        return [self._tools[tid] for tid in tool_ids if tid in self._tools]

    def list_all(self) -> list[Tool]:
        return list(self._tools.values())
