"""MCP on-demand adapter — per-call handshake / list_tools / invoke_tool.

Supports stdio / sse / http via the `mcp` SDK. Each operation opens a
fresh session; we do not keep long-lived connections here — that's the
startup-time `execution.mcp_client` responsibility.

The Protocol is the injection seam: tests pass a fake adapter into
`MCPService`; production wires in `RealMCPAdapter`.
"""

from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass
from typing import Protocol, cast, runtime_checkable

import structlog

from allhands.core import MCPHealth, MCPServer, MCPTransport

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
            log.info("mcp.handshake.failed", server=server.name, error=str(exc))
            return MCPHealth.UNREACHABLE
        return MCPHealth.OK

    async def list_tools(self, server: MCPServer) -> list[MCPToolInfo]:
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
        try:
            return await asyncio.wait_for(
                self._invoke_tool(server, tool_name, arguments),
                timeout=self._timeout_s,
            )
        except (TimeoutError, _AuthError) as exc:
            raise MCPInvocationError(str(exc) or "mcp invoke_tool failed") from exc
        except Exception as exc:
            raise MCPInvocationError(str(exc) or "mcp invoke_tool failed") from exc

    async def _probe(self, server: MCPServer) -> None:
        async with self._session(server) as session:
            await session.initialize()
            await session.list_tools()

    async def _list_tools(self, server: MCPServer) -> list[MCPToolInfo]:
        async with self._session(server) as session:
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
        async with self._session(server) as session:
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

    def _session(self, server: MCPServer) -> _SessionCM:
        if server.transport == MCPTransport.STDIO:
            return _StdioSessionCM(server.config)
        if server.transport == MCPTransport.SSE:
            return _SseSessionCM(server.config)
        if server.transport == MCPTransport.HTTP:
            return _HttpSessionCM(server.config)
        raise MCPInvocationError(f"unsupported transport: {server.transport}")


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
    def __init__(self, config: dict[str, object]) -> None:
        self._config = config
        self._stack: contextlib.AsyncExitStack | None = None

    async def __aenter__(self) -> _Session:
        from mcp import ClientSession
        from mcp.client.sse import sse_client

        url = str(self._config.get("url", ""))
        if not url:
            raise MCPInvocationError("sse transport requires 'url' in config")
        raw_headers = self._config.get("headers", {})
        headers: dict[str, str] = (
            {str(k): str(v) for k, v in raw_headers.items()}
            if isinstance(raw_headers, dict)
            else {}
        )
        self._stack = contextlib.AsyncExitStack()
        try:
            read, write = await self._stack.enter_async_context(sse_client(url, headers=headers))
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
    def __init__(self, config: dict[str, object]) -> None:
        self._config = config
        self._stack: contextlib.AsyncExitStack | None = None

    async def __aenter__(self) -> _Session:
        from mcp import ClientSession
        from mcp.client.streamable_http import streamablehttp_client

        url = str(self._config.get("url", ""))
        if not url:
            raise MCPInvocationError("http transport requires 'url' in config")
        raw_headers = self._config.get("headers", {})
        headers: dict[str, str] = (
            {str(k): str(v) for k, v in raw_headers.items()}
            if isinstance(raw_headers, dict)
            else {}
        )
        self._stack = contextlib.AsyncExitStack()
        try:
            conn = await self._stack.enter_async_context(
                streamablehttp_client(url, headers=headers),
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
    msg = str(exc).lower()
    return "401" in msg or "403" in msg or "unauthoriz" in msg or "forbidden" in msg
