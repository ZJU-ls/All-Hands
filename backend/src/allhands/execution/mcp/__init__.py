"""On-demand MCP adapter — used by MCPService for UI probing / Agent invocation.

Distinct from `execution.mcp_client` which populates the ToolRegistry at
startup. This module opens a short-lived session per operation, and is
the injection seam for tests.
"""

from allhands.execution.mcp.adapter import (
    MCPAdapter,
    MCPInvocationError,
    MCPToolInfo,
    RealMCPAdapter,
)

__all__ = [
    "MCPAdapter",
    "MCPInvocationError",
    "MCPToolInfo",
    "RealMCPAdapter",
]
