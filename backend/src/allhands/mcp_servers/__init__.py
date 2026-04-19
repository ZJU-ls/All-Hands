"""Bundled MCP servers shipped with allhands.

Each sub-package under this namespace is a runnable MCP server process.
They exist so the platform always has at least one working MCP endpoint
out-of-the-box, without requiring the user to install npx/npm or reach
the public internet to pull a reference server.

Invocation convention:
    python -m allhands.mcp_servers.<name>

See `allhands_core/` for the canonical example (fetch_url / read_text_file
/ now — three safe, useful tools good enough for an end-to-end demo).
"""
