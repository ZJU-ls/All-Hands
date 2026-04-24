"""Unit tests for the MCP auth abstraction (core + adapter).

Covers:
- parse_auth() across the three config shapes (structured / legacy headers / none)
- redact_config() masking of sensitive keys (with last-4 preservation)
- RealMCPAdapter._resolve_headers for all four auth types
- oauth2_client_credentials: happy path, cache hit, error path
- RealMCPAdapter guards list_tools / invoke_tool on enabled=False
"""

from __future__ import annotations

import pytest

from allhands.core import (
    MCPAuth,
    MCPAuthType,
    MCPHealth,
    MCPServer,
    MCPTransport,
    parse_auth,
    redact_config,
)
from allhands.execution.mcp.adapter import MCPInvocationError, RealMCPAdapter

# ─── parse_auth ────────────────────────────────────────────────────────────


def test_parse_auth_structured_bearer() -> None:
    a = parse_auth({"auth": {"type": "bearer", "token": "tok"}})
    assert a.type == MCPAuthType.BEARER
    assert a.token == "tok"


def test_parse_auth_structured_oauth_cc() -> None:
    a = parse_auth(
        {
            "auth": {
                "type": "oauth2_client_credentials",
                "token_url": "https://auth/token",
                "client_id": "cid",
                "client_secret": "sec",
                "scope": "read",
            },
        },
    )
    assert a.type == MCPAuthType.OAUTH2_CLIENT_CREDENTIALS
    assert a.token_url == "https://auth/token"
    assert a.scope == "read"


def test_parse_auth_legacy_headers_upgraded_to_custom() -> None:
    a = parse_auth({"headers": {"Authorization": "Bearer zzz"}})
    assert a.type == MCPAuthType.CUSTOM_HEADERS
    assert a.headers["Authorization"] == "Bearer zzz"


def test_parse_auth_empty_returns_none() -> None:
    assert parse_auth({}).type == MCPAuthType.NONE
    assert parse_auth(None).type == MCPAuthType.NONE


def test_parse_auth_structured_wins_over_legacy_headers() -> None:
    a = parse_auth(
        {
            "headers": {"X-Legacy": "v"},
            "auth": {"type": "bearer", "token": "new"},
        },
    )
    assert a.type == MCPAuthType.BEARER
    assert a.token == "new"


# ─── redact_config ─────────────────────────────────────────────────────────


def test_redact_masks_token_with_last_4() -> None:
    out = redact_config({"auth": {"token": "sk-verylongsecret"}})
    assert out["auth"]["token"] == "••••cret"


def test_redact_masks_short_token_fully() -> None:
    assert redact_config({"auth": {"token": "xyz"}})["auth"]["token"] == "••••"


def test_redact_preserves_non_sensitive() -> None:
    out = redact_config({"url": "https://x", "auth": {"type": "bearer", "token": "abcdefg"}})
    assert out["url"] == "https://x"
    assert out["auth"]["type"] == "bearer"
    assert out["auth"]["token"].startswith("••••")


def test_redact_masks_custom_header_authorization() -> None:
    out = redact_config({"headers": {"Authorization": "Bearer verylongvalue"}})
    assert out["headers"]["Authorization"] == "••••alue"


def test_redact_non_dict_returns_empty_dict() -> None:
    assert redact_config(None) == {}


# ─── adapter header resolution ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_resolve_headers_none() -> None:
    a = RealMCPAdapter(timeout_s=1)
    assert await a._resolve_headers(MCPAuth(type=MCPAuthType.NONE)) == {}


@pytest.mark.asyncio
async def test_resolve_headers_bearer() -> None:
    a = RealMCPAdapter(timeout_s=1)
    h = await a._resolve_headers(MCPAuth(type=MCPAuthType.BEARER, token="tok"))
    assert h == {"Authorization": "Bearer tok"}


@pytest.mark.asyncio
async def test_resolve_headers_bearer_empty_token_fails() -> None:
    a = RealMCPAdapter(timeout_s=1)
    with pytest.raises(Exception, match="bearer auth"):
        await a._resolve_headers(MCPAuth(type=MCPAuthType.BEARER, token=None))


@pytest.mark.asyncio
async def test_resolve_headers_custom() -> None:
    a = RealMCPAdapter(timeout_s=1)
    h = await a._resolve_headers(
        MCPAuth(type=MCPAuthType.CUSTOM_HEADERS, headers={"X-API-Key": "sk_x"}),
    )
    assert h == {"X-API-Key": "sk_x"}


# ─── oauth2 client credentials ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_oauth_cc_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mock httpx.AsyncClient.post to return a fake token."""
    import httpx

    captured: dict[str, object] = {}

    class FakeResponse:
        status_code = 200

        def json(self) -> dict[str, object]:
            return {"access_token": "at-123", "expires_in": 600}

        @property
        def text(self) -> str:
            return ""

    class FakeClient:
        def __init__(self, *a: object, **kw: object) -> None:
            pass

        async def __aenter__(self) -> FakeClient:
            return self

        async def __aexit__(self, *a: object) -> None:
            pass

        async def post(self, url: str, data: dict[str, str]) -> FakeResponse:
            captured["url"] = url
            captured["data"] = data
            return FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)

    a = RealMCPAdapter(timeout_s=1)
    auth = MCPAuth(
        type=MCPAuthType.OAUTH2_CLIENT_CREDENTIALS,
        token_url="https://auth/token",
        client_id="cid",
        client_secret="sec",
        scope="read",
    )
    h1 = await a._resolve_headers(auth)
    assert h1 == {"Authorization": "Bearer at-123"}
    assert captured["url"] == "https://auth/token"
    assert captured["data"]["grant_type"] == "client_credentials"
    assert captured["data"]["scope"] == "read"

    # Second call: cache hit (if we clear captured, a.post should not be re-called).
    captured.clear()
    h2 = await a._resolve_headers(auth)
    assert h2 == {"Authorization": "Bearer at-123"}
    assert captured == {}  # no new HTTP call


@pytest.mark.asyncio
async def test_oauth_cc_missing_fields() -> None:
    a = RealMCPAdapter(timeout_s=1)
    with pytest.raises(Exception, match="requires"):
        await a._resolve_headers(
            MCPAuth(type=MCPAuthType.OAUTH2_CLIENT_CREDENTIALS, token_url="x"),
        )


@pytest.mark.asyncio
async def test_oauth_cc_http_400_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    class FakeResponse:
        status_code = 401
        text = "unauthorized_client"

        def json(self) -> dict[str, object]:  # pragma: no cover
            return {}

    class FakeClient:
        def __init__(self, *a: object, **kw: object) -> None:
            pass

        async def __aenter__(self) -> FakeClient:
            return self

        async def __aexit__(self, *a: object) -> None:
            pass

        async def post(self, url: str, data: dict[str, str]) -> FakeResponse:
            return FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)

    a = RealMCPAdapter(timeout_s=1)
    auth = MCPAuth(
        type=MCPAuthType.OAUTH2_CLIENT_CREDENTIALS,
        token_url="https://auth/token",
        client_id="cid",
        client_secret="sec",
    )
    with pytest.raises(Exception, match="401"):
        await a._resolve_headers(auth)


# ─── enabled gate on list_tools / invoke_tool ──────────────────────────────


@pytest.mark.asyncio
async def test_list_tools_blocks_disabled_server() -> None:
    a = RealMCPAdapter(timeout_s=1)
    server = MCPServer(
        id="s1",
        name="disabled",
        transport=MCPTransport.HTTP,
        config={"url": "http://x"},
        enabled=False,
    )
    with pytest.raises(MCPInvocationError, match="disabled"):
        await a.list_tools(server)


@pytest.mark.asyncio
async def test_invoke_tool_blocks_disabled_server() -> None:
    a = RealMCPAdapter(timeout_s=1)
    server = MCPServer(
        id="s1",
        name="disabled",
        transport=MCPTransport.HTTP,
        config={"url": "http://x"},
        enabled=False,
    )
    with pytest.raises(MCPInvocationError, match="disabled"):
        await a.invoke_tool(server, "anything", {})


@pytest.mark.asyncio
async def test_handshake_disabled_returns_unknown() -> None:
    """Pre-existing behavior preserved — disabled is not unreachable, it's unknown."""
    a = RealMCPAdapter(timeout_s=1)
    server = MCPServer(
        id="s1",
        name="disabled",
        transport=MCPTransport.HTTP,
        config={"url": "http://x"},
        enabled=False,
    )
    assert await a.handshake(server) == MCPHealth.UNKNOWN
