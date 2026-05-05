"""Meta tools for MCP server management.

Mirror `api/routers/mcp_servers.py` — each REST write has a semantic twin so
Lead Agent can do via chat what users do in the `/mcp-servers` UI. Supports
stdio / sse / http transports; connection testing and tool invocation are
part of the Agent's surface area so a conversation can fully validate a
new integration.
"""

from __future__ import annotations

from allhands.core import Tool, ToolKind, ToolScope

LIST_MCP_SERVERS_TOOL = Tool(
    id="allhands.meta.list_mcp_servers",
    kind=ToolKind.META,
    name="list_mcp_servers",
    description="List all registered MCP servers with transport/health/enabled state.",
    input_schema={"type": "object", "properties": {}},
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

GET_MCP_SERVER_TOOL = Tool(
    id="allhands.meta.get_mcp_server",
    kind=ToolKind.META,
    name="get_mcp_server",
    description="Get a single MCP server's full detail including config and exposed tools.",
    input_schema={
        "type": "object",
        "properties": {"server_id": {"type": "string"}},
        "required": ["server_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

_AUTH_SCHEMA: dict[str, object] = {
    "type": "object",
    "description": (
        "Optional auth block for remote transports (sse / http). Stored at "
        "config.auth. Four types — 'none' (default), 'bearer' (token), "
        "'custom_headers' (headers map), 'oauth2_client_credentials' "
        "(token_url + client_id + client_secret [+ scope])."
    ),
    "properties": {
        "type": {
            "type": "string",
            "enum": [
                "none",
                "bearer",
                "custom_headers",
                "oauth2_client_credentials",
            ],
        },
        "token": {"type": "string", "description": "bearer only"},
        "headers": {
            "type": "object",
            "description": "custom_headers only — {HeaderName: Value}",
        },
        "token_url": {"type": "string", "description": "oauth2_client_credentials only"},
        "client_id": {"type": "string", "description": "oauth2_client_credentials only"},
        "client_secret": {"type": "string", "description": "oauth2_client_credentials only"},
        "scope": {"type": "string", "description": "oauth2_client_credentials (optional)"},
    },
}


ADD_MCP_SERVER_TOOL = Tool(
    id="allhands.meta.add_mcp_server",
    kind=ToolKind.META,
    name="add_mcp_server",
    description=(
        "Register a new MCP server. transport is stdio|sse|http; config is "
        "transport-specific: {command,args,env} for stdio, {url, auth?} for "
        "sse|http. See auth subschema for supported auth types."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "transport": {"type": "string", "enum": ["stdio", "sse", "http"]},
            "config": {
                "type": "object",
                "properties": {
                    "command": {"type": "string"},
                    "args": {"type": "array", "items": {"type": "string"}},
                    "env": {"type": "object"},
                    "url": {"type": "string"},
                    "auth": _AUTH_SCHEMA,
                },
            },
            "enabled": {"type": "boolean", "default": True},
        },
        "required": ["name", "transport", "config"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

UPDATE_MCP_SERVER_TOOL = Tool(
    id="allhands.meta.update_mcp_server",
    kind=ToolKind.META,
    name="update_mcp_server",
    description="Update an MCP server's name/config/enabled flag.",
    input_schema={
        "type": "object",
        "properties": {
            "server_id": {"type": "string"},
            "name": {"type": "string"},
            "config": {"type": "object"},
            "enabled": {"type": "boolean"},
        },
        "required": ["server_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

DELETE_MCP_SERVER_TOOL = Tool(
    id="allhands.meta.delete_mcp_server",
    kind=ToolKind.META,
    name="delete_mcp_server",
    description="Permanently remove an MCP server registration.",
    input_schema={
        "type": "object",
        "properties": {"server_id": {"type": "string"}},
        "required": ["server_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.IRREVERSIBLE,
    requires_confirmation=True,
)

TEST_MCP_CONNECTION_TOOL = Tool(
    id="allhands.meta.test_mcp_connection",
    kind=ToolKind.META,
    name="test_mcp_connection",
    description=(
        "Probe an MCP server — handshake + list_tools. Updates health "
        "(ok/unreachable/auth_failed). READ: no state mutation beyond health cache."
    ),
    input_schema={
        "type": "object",
        "properties": {"server_id": {"type": "string"}},
        "required": ["server_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

LIST_MCP_SERVER_TOOLS_TOOL = Tool(
    id="allhands.meta.list_mcp_server_tools",
    kind=ToolKind.META,
    name="list_mcp_server_tools",
    description="List the tools advertised by an MCP server (live fetch).",
    input_schema={
        "type": "object",
        "properties": {"server_id": {"type": "string"}},
        "required": ["server_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

INVOKE_MCP_SERVER_TOOL_TOOL = Tool(
    id="allhands.meta.invoke_mcp_server_tool",
    kind=ToolKind.META,
    name="invoke_mcp_server_tool",
    description=(
        "Invoke one tool on a registered MCP server. External side effect — "
        "WRITE + requires confirmation."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "server_id": {"type": "string"},
            "tool_name": {"type": "string"},
            "arguments": {"type": "object", "default": {}},
        },
        "required": ["server_id", "tool_name"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)


ALL_MCP_SERVER_META_TOOLS = [
    LIST_MCP_SERVERS_TOOL,
    GET_MCP_SERVER_TOOL,
    ADD_MCP_SERVER_TOOL,
    UPDATE_MCP_SERVER_TOOL,
    DELETE_MCP_SERVER_TOOL,
    TEST_MCP_CONNECTION_TOOL,
    LIST_MCP_SERVER_TOOLS_TOOL,
    INVOKE_MCP_SERVER_TOOL_TOOL,
]
