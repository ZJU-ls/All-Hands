"""MCP server domain model.

MCP (Model Context Protocol) servers expose external tools via three transports.
After handshake, their tools enter the ToolRegistry at runtime.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class MCPTransport(StrEnum):
    STDIO = "stdio"
    SSE = "sse"
    HTTP = "http"


class MCPHealth(StrEnum):
    UNKNOWN = "unknown"
    OK = "ok"
    UNREACHABLE = "unreachable"
    AUTH_FAILED = "auth_failed"


class MCPServer(BaseModel):
    id: str
    name: str = Field(..., min_length=1)
    transport: MCPTransport
    config: dict[str, object]  # {command, args, env} or {url, headers}
    enabled: bool = True
    exposed_tool_ids: list[str] = Field(default_factory=list)
    last_handshake_at: datetime | None = None
    health: MCPHealth = MCPHealth.UNKNOWN
