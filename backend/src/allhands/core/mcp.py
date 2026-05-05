"""MCP server domain model.

MCP (Model Context Protocol) servers expose external tools via three transports.
After handshake, their tools enter the ToolRegistry at runtime.

Auth (2026-04-24 · feat/mcp-auth-v2):
    `config.auth` is an optional structured block. Four types — `none`,
    `bearer`, `custom_headers`, `oauth2_client_credentials`. Legacy configs
    that carried a raw `headers` map at the top level are still honored
    (treated as `custom_headers`). The adapter resolves this into a concrete
    `{Header: Value}` dict at handshake time.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any

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


class MCPAuthType(StrEnum):
    NONE = "none"
    BEARER = "bearer"
    CUSTOM_HEADERS = "custom_headers"
    OAUTH2_CLIENT_CREDENTIALS = "oauth2_client_credentials"


class MCPAuth(BaseModel):
    """Structured auth block stored under `config.auth`.

    Only the fields relevant to `type` are consulted; others are ignored.
    Secrets are plain strings for now (encryption-at-rest is a separate
    contract-level decision; see plans/2026-04-24-mcp-overhaul.md followup 2).
    """

    type: MCPAuthType = MCPAuthType.NONE
    # bearer
    token: str | None = None
    # custom_headers
    headers: dict[str, str] = Field(default_factory=dict)
    # oauth2_client_credentials
    token_url: str | None = None
    client_id: str | None = None
    client_secret: str | None = None
    scope: str | None = None


SENSITIVE_AUTH_KEYS: frozenset[str] = frozenset(
    {"token", "client_secret", "authorization", "api_key", "apikey"},
)


def parse_auth(config: dict[str, Any] | None) -> MCPAuth:
    """Best-effort extraction of MCPAuth from a server config blob.

    Rules (first match wins):
    1. `config["auth"]` is a dict → validate via MCPAuth.
    2. Legacy: `config["headers"]` is a non-empty dict → treat as custom_headers.
    3. Else → `none`.
    """
    if not isinstance(config, dict):
        return MCPAuth()
    raw_auth = config.get("auth")
    if isinstance(raw_auth, dict):
        return MCPAuth.model_validate(raw_auth)
    legacy_headers = config.get("headers")
    if isinstance(legacy_headers, dict) and legacy_headers:
        return MCPAuth(
            type=MCPAuthType.CUSTOM_HEADERS,
            headers={str(k): str(v) for k, v in legacy_headers.items()},
        )
    return MCPAuth()


def redact_config(config: dict[str, Any] | None) -> dict[str, Any]:
    """Return a deep-copy of config with sensitive auth values masked.

    UI uses this before showing raw JSON so tokens / client_secrets never
    appear verbatim in the Overview panel. The last 4 chars are preserved
    for operator recognition.
    """

    def _mask(v: str) -> str:
        if len(v) <= 4:
            return "••••"
        return "••••" + v[-4:]

    def _walk(obj: Any) -> Any:
        if isinstance(obj, dict):
            out: dict[str, Any] = {}
            for k, v in obj.items():
                key_lower = str(k).lower()
                if key_lower in SENSITIVE_AUTH_KEYS and isinstance(v, str):
                    out[k] = _mask(v)
                else:
                    out[k] = _walk(v)
            return out
        if isinstance(obj, list):
            return [_walk(x) for x in obj]
        return obj

    if not isinstance(config, dict):
        return {}
    walked = _walk(config)
    assert isinstance(walked, dict)
    return walked


class MCPServer(BaseModel):
    id: str
    name: str = Field(..., min_length=1)
    transport: MCPTransport
    config: dict[str, object]  # {command, args, env} or {url, headers, auth}
    enabled: bool = True
    exposed_tool_ids: list[str] = Field(default_factory=list)
    last_handshake_at: datetime | None = None
    health: MCPHealth = MCPHealth.UNKNOWN
