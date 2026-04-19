"""allhands-core MCP server — stdio entrypoint.

Runs FastMCP over stdio and exposes the three tools from `tools.py`. The
server is designed to be invoked by the allhands ToolRegistry MCPClient
via a stdio spawn, but it also speaks vanilla MCP so any MCP-compatible
host (Claude Desktop, mcp-inspector…) can connect to it directly.
"""

from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from allhands.mcp_servers.allhands_core import tools as t

mcp = FastMCP("allhands-core")


@mcp.tool()
async def fetch_url(url: str, timeout_seconds: float = t.DEFAULT_FETCH_TIMEOUT) -> dict[str, Any]:
    """Fetch an HTTP(S) URL and return its body as UTF-8 text.

    Body size is capped at 512KiB — the `truncated` flag in the result
    signals when the source was larger. Non-HTTP schemes are rejected.
    """
    try:
        return await t.fetch_url(url, timeout_seconds=timeout_seconds)
    except t.ToolError as exc:
        return {"error": str(exc)}


@mcp.tool()
async def read_text_file(path: str, max_bytes: int = t.MAX_FILE_BYTES) -> dict[str, Any]:
    """Read a small UTF-8 text file from disk (binary files are refused)."""
    try:
        return await t.read_text_file(path, max_bytes=max_bytes)
    except t.ToolError as exc:
        return {"error": str(exc)}


@mcp.tool()
def now(tz: str = "UTC") -> dict[str, Any]:
    """Return the current wall-clock time in the given IANA timezone (default UTC)."""
    try:
        return t.now(tz=tz)
    except t.ToolError as exc:
        return {"error": str(exc)}


def main() -> None:
    """Entrypoint for `python -m allhands.mcp_servers.allhands_core`."""
    mcp.run()


if __name__ == "__main__":
    main()
