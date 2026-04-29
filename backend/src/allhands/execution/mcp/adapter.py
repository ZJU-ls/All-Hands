"""MCP on-demand adapter — per-call handshake / list_tools / invoke_tool.

Supports stdio / sse / http via the `mcp` SDK. Each operation opens a
fresh session; we do not keep long-lived connections here — that's the
startup-time `execution.mcp_client` responsibility.

Auth (2026-04-24):
    The adapter resolves `config.auth` into concrete HTTP headers for
    remote transports (sse / http). Four auth types are supported:
    `none`, `bearer`, `custom_headers`, `oauth2_client_credentials`.
    OAuth access tokens are cached in-process keyed by (token_url,
    client_id, scope) until ~30s before their declared expiry.

The Protocol is the injection seam: tests pass a fake adapter into
`MCPService`; production wires in `RealMCPAdapter`.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from dataclasses import dataclass
from typing import Protocol, cast, runtime_checkable

import structlog

from allhands.core import (
    MCPAuth,
    MCPAuthType,
    MCPHealth,
    MCPServer,
    MCPTransport,
    parse_auth,
)

log = structlog.get_logger()


class MCPInvocationError(Exception):
    """Raised when a list_tools / invoke_tool call cannot complete."""


@dataclass(frozen=True)
class MCPToolInfo:
    name: str
    description: str
    input_schema: dict[str, object]


@runtime_checkable
class MCPAdapter(Protocol):
    async def handshake(self, server: MCPServer) -> MCPHealth: ...
    async def list_tools(self, server: MCPServer) -> list[MCPToolInfo]: ...
    async def invoke_tool(
        self,
        server: MCPServer,
        tool_name: str,
        arguments: dict[str, object],
    ) -> dict[str, object]: ...


class RealMCPAdapter:
    """Concrete adapter backed by the `mcp` python SDK."""

    def __init__(self, timeout_s: float = 10.0) -> None:
        self._timeout_s = timeout_s
        self._oauth_cache: dict[tuple[str, str, str], _CachedToken] = {}

    async def handshake(self, server: MCPServer) -> MCPHealth:
        if not server.enabled:
            return MCPHealth.UNKNOWN
        try:
            await asyncio.wait_for(self._probe(server), timeout=self._timeout_s)
        except TimeoutError:
            log.info("mcp.handshake.timeout", server=server.name)
            return MCPHealth.UNREACHABLE
        except _AuthError:
            return MCPHealth.AUTH_FAILED
        except Exception as exc:
            if _looks_like_auth(exc):
                return MCPHealth.AUTH_FAILED
            log.info("mcp.handshake.failed", server=server.name, error=str(exc))
            return MCPHealth.UNREACHABLE
        return MCPHealth.OK

    async def list_tools(self, server: MCPServer) -> list[MCPToolInfo]:
        self._guard_enabled(server)
        try:
            return await asyncio.wait_for(self._list_tools(server), timeout=self._timeout_s)
        except (TimeoutError, _AuthError) as exc:
            raise MCPInvocationError(str(exc) or "mcp list_tools failed") from exc
        except Exception as exc:
            raise MCPInvocationError(str(exc) or "mcp list_tools failed") from exc

    async def invoke_tool(
        self,
        server: MCPServer,
        tool_name: str,
        arguments: dict[str, object],
    ) -> dict[str, object]:
        self._guard_enabled(server)
        try:
            return await asyncio.wait_for(
                self._invoke_tool(server, tool_name, arguments),
                timeout=self._timeout_s,
            )
        except (TimeoutError, _AuthError) as exc:
            raise MCPInvocationError(str(exc) or "mcp invoke_tool failed") from exc
        except Exception as exc:
            raise MCPInvocationError(str(exc) or "mcp invoke_tool failed") from exc

    @staticmethod
    def _guard_enabled(server: MCPServer) -> None:
        if not server.enabled:
            raise MCPInvocationError(f"server {server.name!r} is disabled")

    async def _probe(self, server: MCPServer) -> None:
        async with await self._session(server) as session:
            await session.initialize()
            await session.list_tools()

    async def _list_tools(self, server: MCPServer) -> list[MCPToolInfo]:
        async with await self._session(server) as session:
            await session.initialize()
            result = await session.list_tools()
            return [
                MCPToolInfo(
                    name=t.name,  # type: ignore[attr-defined]
                    description=t.description or "",  # type: ignore[attr-defined]
                    input_schema=(
                        dict(t.inputSchema)  # type: ignore[attr-defined]
                        if t.inputSchema  # type: ignore[attr-defined]
                        else {"type": "object"}
                    ),
                )
                for t in result.tools
            ]

    async def _invoke_tool(
        self,
        server: MCPServer,
        tool_name: str,
        arguments: dict[str, object],
    ) -> dict[str, object]:
        async with await self._session(server) as session:
            await session.initialize()
            result = await session.call_tool(tool_name, arguments)
            content = getattr(result, "content", None)
            if content is None:
                return {"result": str(result)}
            texts: list[str] = []
            for part in content:
                text = getattr(part, "text", None)
                if text:
                    texts.append(str(text))
                else:
                    texts.append(str(part))
            return {"result": "\n".join(texts) if texts else str(result)}

    async def _session(self, server: MCPServer) -> _SessionCM:
        if server.transport == MCPTransport.STDIO:
            return _StdioSessionCM(server.config)
        auth = parse_auth(server.config)
        headers = await self._resolve_headers(auth)
        if server.transport == MCPTransport.SSE:
            return _SseSessionCM(server.config, headers)
        if server.transport == MCPTransport.HTTP:
            return _HttpSessionCM(server.config, headers)
        raise MCPInvocationError(f"unsupported transport: {server.transport}")

    async def _resolve_headers(self, auth: MCPAuth) -> dict[str, str]:
        if auth.type == MCPAuthType.NONE:
            return {}
        if auth.type == MCPAuthType.BEARER:
            if not auth.token:
                raise _AuthError("bearer auth selected but token is empty")
            return {"Authorization": f"Bearer {auth.token}"}
        if auth.type == MCPAuthType.CUSTOM_HEADERS:
            return {str(k): str(v) for k, v in (auth.headers or {}).items()}
        if auth.type == MCPAuthType.OAUTH2_CLIENT_CREDENTIALS:
            token = await self._oauth_client_credentials(auth)
            return {"Authorization": f"Bearer {token}"}
        raise _AuthError(f"unsupported auth type: {auth.type}")

    async def _oauth_client_credentials(self, auth: MCPAuth) -> str:
        if not (auth.token_url and auth.client_id and auth.client_secret):
            raise _AuthError(
                "oauth2_client_credentials requires token_url / client_id / client_secret",
            )
        cache_key = (auth.token_url, auth.client_id, auth.scope or "")
        now = time.monotonic()
        cached = self._oauth_cache.get(cache_key)
        if cached and cached.expires_at > now + 5:
            return cached.access_token
        try:
            import httpx
        except ImportError as exc:  # pragma: no cover - httpx ships with fastapi stack
            raise _AuthError("httpx is required for oauth2_client_credentials") from exc

        data: dict[str, str] = {
            "grant_type": "client_credentials",
            "client_id": auth.client_id,
            "client_secret": auth.client_secret,
        }
        if auth.scope:
            data["scope"] = auth.scope
        async with httpx.AsyncClient(timeout=self._timeout_s) as client:
            try:
                resp = await client.post(auth.token_url, data=data)
            except httpx.HTTPError as exc:
                raise _AuthError(f"oauth2 token endpoint unreachable: {exc}") from exc
        if resp.status_code >= 400:
            raise _AuthError(
                f"oauth2 token endpoint returned {resp.status_code}: {resp.text[:200]}",
            )
        try:
            payload = resp.json()
        except ValueError as exc:
            raise _AuthError("oauth2 token endpoint returned non-JSON") from exc
        access_token = payload.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise _AuthError("oauth2 token endpoint returned no access_token")
        expires_in_raw = payload.get("expires_in", 300)
        try:
            expires_in = float(expires_in_raw)
        except (TypeError, ValueError):
            expires_in = 300.0
        self._oauth_cache[cache_key] = _CachedToken(
            access_token=access_token,
            expires_at=now + max(expires_in - 30, 30),
        )
        return access_token


@dataclass(frozen=True)
class _CachedToken:
    access_token: str
    expires_at: float


class _AuthError(Exception):
    pass


class _SessionCM(contextlib.AbstractAsyncContextManager["_Session"]):
    """Structural base — concrete subclasses yield an mcp ClientSession-like obj."""


class _Session(Protocol):
    async def initialize(self) -> object: ...
    async def list_tools(self) -> _ListToolsResult: ...
    async def call_tool(self, name: str, arguments: dict[str, object]) -> object: ...


class _ListToolsResult(Protocol):
    tools: list[object]


class _StdioSessionCM(_SessionCM):
    def __init__(self, config: dict[str, object]) -> None:
        self._config = config
        self._stack: contextlib.AsyncExitStack | None = None

    async def __aenter__(self) -> _Session:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        raw_args = self._config.get("args", [])
        args: list[str] = list(raw_args) if isinstance(raw_args, list) else []
        raw_env = self._config.get("env", {})
        env: dict[str, str] = (
            {str(k): str(v) for k, v in raw_env.items()} if isinstance(raw_env, dict) else {}
        )
        params = StdioServerParameters(
            command=str(self._config.get("command", "")),
            args=args,
            env=env,
        )
        self._stack = contextlib.AsyncExitStack()
        try:
            read, write = await self._stack.enter_async_context(stdio_client(params))
            session = await self._stack.enter_async_context(ClientSession(read, write))
        except Exception:
            await self._stack.aclose()
            self._stack = None
            raise
        return cast("_Session", session)

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        if self._stack is not None:
            await self._stack.aclose()
            self._stack = None


class _SseSessionCM(_SessionCM):
    def __init__(self, config: dict[str, object], headers: dict[str, str]) -> None:
        self._config = config
        self._headers = headers
        self._stack: contextlib.AsyncExitStack | None = None

    async def __aenter__(self) -> _Session:
        from mcp import ClientSession
        from mcp.client.sse import sse_client

        url = str(self._config.get("url", ""))
        if not url:
            raise MCPInvocationError("sse transport requires 'url' in config")
        self._stack = contextlib.AsyncExitStack()
        try:
            read, write = await self._stack.enter_async_context(
                sse_client(url, headers=self._headers),
            )
            session = await self._stack.enter_async_context(ClientSession(read, write))
        except Exception as exc:
            await self._stack.aclose()
            self._stack = None
            if _looks_like_auth(exc):
                raise _AuthError(str(exc)) from exc
            raise
        return cast("_Session", session)

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        if self._stack is not None:
            await self._stack.aclose()
            self._stack = None


class _HttpSessionCM(_SessionCM):
    def __init__(self, config: dict[str, object], headers: dict[str, str]) -> None:
        self._config = config
        self._headers = headers
        self._stack: contextlib.AsyncExitStack | None = None

    async def __aenter__(self) -> _Session:
        from mcp import ClientSession
        from mcp.client.streamable_http import streamablehttp_client

        url = str(self._config.get("url", ""))
        if not url:
            raise MCPInvocationError("http transport requires 'url' in config")
        self._stack = contextlib.AsyncExitStack()
        try:
            conn = await self._stack.enter_async_context(
                streamablehttp_client(url, headers=self._headers),
            )
            read, write = conn[0], conn[1]
            session = await self._stack.enter_async_context(ClientSession(read, write))
        except Exception as exc:
            await self._stack.aclose()
            self._stack = None
            if _looks_like_auth(exc):
                raise _AuthError(str(exc)) from exc
            raise
        return cast("_Session", session)

    async def __aexit__(self, exc_type: object, exc: object, tb: object) -> None:
        if self._stack is not None:
            await self._stack.aclose()
            self._stack = None


def _looks_like_auth(exc: BaseException) -> bool:
    """Detect auth-failure exceptions.

    Prefer structural status-code inspection (httpx.HTTPStatusError) before
    falling back to substring matching.
    """
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if status in (401, 403):
        return True
    msg = str(exc).lower()
    return "401" in msg or "403" in msg or "unauthoriz" in msg or "forbidden" in msg
