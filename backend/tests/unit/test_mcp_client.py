"""MCPClient · register/unregister contract.

Validates the 2026-04-29 rewrite: tools register as concrete
``mcp__<server>__<tool>`` ids, executor closures don't capture stale
sessions, and the registry stays in sync with server lifecycle events.
"""

from __future__ import annotations

import pytest

from allhands.core import MCPHealth, MCPServer, MCPTransport
from allhands.execution.mcp.adapter import MCPInvocationError, MCPToolInfo
from allhands.execution.mcp_client import (
    MCPClient,
    build_mcp_tool_id,
    parse_mcp_tool_id,
)
from allhands.execution.registry import ToolRegistry


def _mk_server(name: str = "github", server_id: str = "srv-1") -> MCPServer:
    return MCPServer(
        id=server_id,
        name=name,
        transport=MCPTransport.STDIO,
        config={"command": "noop", "args": [], "env": {}},
        enabled=True,
        exposed_tool_ids=[],
        last_handshake_at=None,
        health=MCPHealth.UNKNOWN,
    )


class _FakeAdapter:
    def __init__(
        self,
        tools: list[MCPToolInfo] | None = None,
        list_raises: Exception | None = None,
        invoke_returns: dict[str, object] | None = None,
        invoke_raises: Exception | None = None,
    ) -> None:
        self._tools = tools or []
        self._list_raises = list_raises
        self._invoke_returns = invoke_returns or {"result": "ok"}
        self._invoke_raises = invoke_raises
        self.invocations: list[tuple[str, str, dict[str, object]]] = []

    async def handshake(self, server: MCPServer) -> MCPHealth:
        return MCPHealth.OK

    async def list_tools(self, server: MCPServer) -> list[MCPToolInfo]:
        if self._list_raises is not None:
            raise self._list_raises
        return list(self._tools)

    async def invoke_tool(
        self,
        server: MCPServer,
        tool_name: str,
        arguments: dict[str, object],
    ) -> dict[str, object]:
        self.invocations.append((server.name, tool_name, arguments))
        if self._invoke_raises is not None:
            raise self._invoke_raises
        return self._invoke_returns


def test_build_mcp_tool_id_uses_double_underscore() -> None:
    assert build_mcp_tool_id("github", "create_issue") == "mcp__github__create_issue"


def test_parse_mcp_tool_id_roundtrip() -> None:
    assert parse_mcp_tool_id("mcp__github__create_issue") == ("github", "create_issue")
    # Non-MCP and malformed return None.
    assert parse_mcp_tool_id("allhands.builtin.fetch_url") is None
    assert parse_mcp_tool_id("mcp__no-second-sep") is None


@pytest.mark.asyncio
async def test_register_server_tools_creates_concrete_entries() -> None:
    registry = ToolRegistry()
    adapter = _FakeAdapter(
        tools=[
            MCPToolInfo(
                name="read_file",
                description="Read a file from disk",
                input_schema={"type": "object", "required": ["path"]},
            ),
            MCPToolInfo(name="write_file", description="", input_schema={"type": "object"}),
        ]
    )
    client = MCPClient(registry=registry, adapter=adapter)
    server = _mk_server("filesystem", "srv-fs")

    tools = await client.register_server_tools(server)
    ids = [t.id for t in tools]
    assert ids == ["mcp__filesystem__read_file", "mcp__filesystem__write_file"]

    # Both registered.
    for tid in ids:
        tool, _executor = registry.get(tid)
        assert tool.id == tid
        assert tool.name == tid  # consistent id+name (LLM sees it)
    # Schema came from adapter, not a hard-coded `{"type": "object"}` wrapper.
    read_tool, _ = registry.get("mcp__filesystem__read_file")
    assert read_tool.input_schema["required"] == ["path"]


@pytest.mark.asyncio
async def test_executor_forwards_to_adapter_invoke() -> None:
    """Closure must NOT capture a session — adapter handles short-lived
    connections per call. Executor is a plain coroutine."""
    registry = ToolRegistry()
    adapter = _FakeAdapter(
        tools=[
            MCPToolInfo(name="read_file", description="", input_schema={}),
        ],
        invoke_returns={"result": "<file contents>"},
    )
    client = MCPClient(registry=registry, adapter=adapter)
    server = _mk_server("filesystem", "srv-fs")
    await client.register_server_tools(server)

    _, executor = registry.get("mcp__filesystem__read_file")
    out = await executor(path="/etc/hosts")
    assert out == {"result": "<file contents>"}
    assert adapter.invocations == [("filesystem", "read_file", {"path": "/etc/hosts"})]


@pytest.mark.asyncio
async def test_executor_returns_error_envelope_on_invoke_failure() -> None:
    """LLM should see structured error so it can self-correct (matches
    the tool_arg_validation + chip-failure path)."""
    registry = ToolRegistry()
    adapter = _FakeAdapter(
        tools=[MCPToolInfo(name="boom", description="", input_schema={})],
        invoke_raises=MCPInvocationError("server crashed"),
    )
    client = MCPClient(registry=registry, adapter=adapter)
    await client.register_server_tools(_mk_server("svc", "srv-1"))

    _, executor = registry.get("mcp__svc__boom")
    out = await executor()
    assert isinstance(out, dict)
    assert out["error"] == "server crashed"
    assert out["server"] == "svc"
    assert out["tool"] == "boom"


@pytest.mark.asyncio
async def test_re_register_updates_stale_tools() -> None:
    """Server config changed → list_tools returns a new shape · old
    entries that no longer exist must be unregistered."""
    registry = ToolRegistry()
    adapter = _FakeAdapter(
        tools=[
            MCPToolInfo(name="a", description="", input_schema={}),
            MCPToolInfo(name="b", description="", input_schema={}),
        ]
    )
    client = MCPClient(registry=registry, adapter=adapter)
    server = _mk_server("svc", "srv-1")
    await client.register_server_tools(server)
    assert client.tool_ids_for_server("srv-1") == ["mcp__svc__a", "mcp__svc__b"]

    # Server upgraded · only `a` survives, new `c` appears.
    adapter._tools = [
        MCPToolInfo(name="a", description="", input_schema={}),
        MCPToolInfo(name="c", description="", input_schema={}),
    ]
    await client.register_server_tools(server)
    assert client.tool_ids_for_server("srv-1") == ["mcp__svc__a", "mcp__svc__c"]
    # Stale `b` gone.
    with pytest.raises(KeyError):
        registry.get("mcp__svc__b")


@pytest.mark.asyncio
async def test_disabled_server_skips_registration() -> None:
    registry = ToolRegistry()
    adapter = _FakeAdapter(tools=[MCPToolInfo(name="x", description="", input_schema={})])
    client = MCPClient(registry=registry, adapter=adapter)
    server = _mk_server("svc", "srv-1").model_copy(update={"enabled": False})
    tools = await client.register_server_tools(server)
    assert tools == []
    assert client.tool_ids_for_server("srv-1") == []


@pytest.mark.asyncio
async def test_unregister_clears_registry() -> None:
    registry = ToolRegistry()
    adapter = _FakeAdapter(
        tools=[
            MCPToolInfo(name="a", description="", input_schema={}),
            MCPToolInfo(name="b", description="", input_schema={}),
        ]
    )
    client = MCPClient(registry=registry, adapter=adapter)
    await client.register_server_tools(_mk_server("svc", "srv-1"))
    assert len(client.tool_ids_for_server("srv-1")) == 2

    await client.unregister_server_tools("srv-1")
    assert client.tool_ids_for_server("srv-1") == []
    with pytest.raises(KeyError):
        registry.get("mcp__svc__a")
    with pytest.raises(KeyError):
        registry.get("mcp__svc__b")


@pytest.mark.asyncio
async def test_list_tools_failure_unregisters_existing() -> None:
    """If a previously-registered server starts failing list_tools, the
    stale registrations get cleaned up so we don't dispatch into a dead
    server."""
    registry = ToolRegistry()
    adapter = _FakeAdapter(tools=[MCPToolInfo(name="a", description="", input_schema={})])
    client = MCPClient(registry=registry, adapter=adapter)
    server = _mk_server("svc", "srv-1")
    await client.register_server_tools(server)
    assert client.tool_ids_for_server("srv-1") == ["mcp__svc__a"]

    adapter._list_raises = MCPInvocationError("server gone")
    tools = await client.register_server_tools(server)
    assert tools == []
    assert client.tool_ids_for_server("srv-1") == []
    with pytest.raises(KeyError):
        registry.get("mcp__svc__a")
