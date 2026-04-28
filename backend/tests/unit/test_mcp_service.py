"""MCPService unit tests — CRUD + live operations against a fake adapter."""

from __future__ import annotations

import pytest

from allhands.core import MCPHealth, MCPServer, MCPTransport
from allhands.execution.mcp.adapter import MCPAdapter, MCPInvocationError, MCPToolInfo
from allhands.services.mcp_service import MCPService, MCPServiceError


class InMemRepo:
    def __init__(self) -> None:
        self._data: dict[str, MCPServer] = {}

    async def get(self, server_id: str) -> MCPServer | None:
        return self._data.get(server_id)

    async def list_all(self) -> list[MCPServer]:
        return list(self._data.values())

    async def upsert(self, server: MCPServer) -> None:
        self._data[server.id] = server

    async def delete(self, server_id: str) -> None:
        self._data.pop(server_id, None)


class FakeAdapter:
    def __init__(
        self,
        *,
        health: MCPHealth = MCPHealth.OK,
        tools: list[MCPToolInfo] | None = None,
        invoke_result: dict[str, object] | None = None,
        raise_on: str | None = None,
    ) -> None:
        self.health = health
        self.tools = tools or []
        self.invoke_result = invoke_result or {"result": "fake"}
        self.raise_on = raise_on
        self.last_invoked: tuple[str, str, dict[str, object]] | None = None

    async def handshake(self, server: MCPServer) -> MCPHealth:
        if self.raise_on == "handshake":
            raise MCPInvocationError("fake handshake err")
        return self.health

    async def list_tools(self, server: MCPServer) -> list[MCPToolInfo]:
        if self.raise_on == "list_tools":
            raise MCPInvocationError("fake list err")
        return list(self.tools)

    async def invoke_tool(
        self,
        server: MCPServer,
        tool_name: str,
        arguments: dict[str, object],
    ) -> dict[str, object]:
        if self.raise_on == "invoke":
            raise MCPInvocationError("fake invoke err")
        self.last_invoked = (server.id, tool_name, dict(arguments))
        return dict(self.invoke_result)


def _svc(
    *,
    adapter: MCPAdapter | None = None,
    seed: list[MCPServer] | None = None,
) -> tuple[MCPService, InMemRepo, FakeAdapter]:
    fake = adapter if isinstance(adapter, FakeAdapter) else FakeAdapter()
    repo = InMemRepo()
    if seed:
        for s in seed:
            repo._data[s.id] = s
    svc = MCPService(repo=repo, adapter=fake)
    return svc, repo, fake


@pytest.mark.asyncio
async def test_add_server_assigns_id_and_eagerly_probes_when_enabled() -> None:
    """Adding an *enabled* server probes immediately so the UI's tool-count
    chip isn't stuck at 0 until the user clicks 'test'. Pre-2026-04-28 it
    stayed UNKNOWN forever — that was the L01 ux bug behind tool count = 0.
    """
    svc, repo, _fake = _svc(adapter=FakeAdapter(tools=[MCPToolInfo("a", "", {})]))
    created = await svc.add(
        name="stdio-1",
        transport=MCPTransport.STDIO,
        config={"command": "echo", "args": []},
    )
    assert created.id
    # Eager probe runs · health flips to OK · tools cached.
    assert created.health == MCPHealth.OK
    assert created.exposed_tool_ids == ["a"]
    assert created.enabled is True
    assert (await repo.get(created.id)) is not None


@pytest.mark.asyncio
async def test_add_server_disabled_skips_eager_probe() -> None:
    svc, _repo, _ = _svc()
    created = await svc.add(
        name="stdio-disabled",
        transport=MCPTransport.STDIO,
        config={"command": "echo"},
        enabled=False,
    )
    # No probe → defaults preserved.
    assert created.health == MCPHealth.UNKNOWN
    assert created.exposed_tool_ids == []


@pytest.mark.asyncio
async def test_add_rejects_duplicate_name() -> None:
    svc, _, _ = _svc()
    await svc.add(name="dup", transport=MCPTransport.STDIO, config={"command": "echo"})
    with pytest.raises(MCPServiceError):
        await svc.add(name="dup", transport=MCPTransport.STDIO, config={"command": "echo"})


@pytest.mark.asyncio
async def test_update_changes_name_config_enabled() -> None:
    svc, _, _ = _svc()
    s = await svc.add(name="orig", transport=MCPTransport.HTTP, config={"url": "http://a"})
    updated = await svc.update(
        s.id,
        name="renamed",
        config={"url": "http://b"},
        enabled=False,
    )
    assert updated is not None
    assert updated.name == "renamed"
    assert updated.config == {"url": "http://b"}
    assert updated.enabled is False


@pytest.mark.asyncio
async def test_update_missing_returns_none() -> None:
    svc, _, _ = _svc()
    assert (await svc.update("missing", name="x")) is None


@pytest.mark.asyncio
async def test_delete_removes_row() -> None:
    svc, repo, _ = _svc()
    s = await svc.add(name="x", transport=MCPTransport.STDIO, config={"command": "echo"})
    await svc.delete(s.id)
    assert (await repo.get(s.id)) is None


@pytest.mark.asyncio
async def test_test_connection_updates_health_and_handshake_ts() -> None:
    svc, _, _fake = _svc(adapter=FakeAdapter(health=MCPHealth.OK))
    s = await svc.add(name="x", transport=MCPTransport.STDIO, config={"command": "echo"})
    result = await svc.test_connection(s.id)
    assert result is not None
    assert result.health == MCPHealth.OK
    assert result.last_handshake_at is not None


@pytest.mark.asyncio
async def test_test_connection_records_unreachable() -> None:
    svc, _, _ = _svc(adapter=FakeAdapter(health=MCPHealth.UNREACHABLE))
    s = await svc.add(name="x", transport=MCPTransport.STDIO, config={"command": "echo"})
    result = await svc.test_connection(s.id)
    assert result is not None
    assert result.health == MCPHealth.UNREACHABLE


@pytest.mark.asyncio
async def test_list_server_tools_returns_adapter_tools() -> None:
    adapter = FakeAdapter(
        tools=[MCPToolInfo(name="a", description="A", input_schema={"type": "object"})],
    )
    svc, _, _ = _svc(adapter=adapter)
    s = await svc.add(name="x", transport=MCPTransport.STDIO, config={"command": "echo"})
    tools = await svc.list_server_tools(s.id)
    assert len(tools) == 1
    assert tools[0].name == "a"


@pytest.mark.asyncio
async def test_list_server_tools_missing_server_raises() -> None:
    svc, _, _ = _svc()
    with pytest.raises(MCPServiceError):
        await svc.list_server_tools("missing")


@pytest.mark.asyncio
async def test_invoke_server_tool_calls_adapter_with_args() -> None:
    adapter = FakeAdapter(invoke_result={"result": "42"})
    svc, _, _ = _svc(adapter=adapter)
    s = await svc.add(name="x", transport=MCPTransport.STDIO, config={"command": "echo"})
    out = await svc.invoke_server_tool(s.id, tool_name="sum", arguments={"a": 1, "b": 2})
    assert out == {"result": "42"}
    assert adapter.last_invoked == (s.id, "sum", {"a": 1, "b": 2})


@pytest.mark.asyncio
async def test_invoke_missing_server_raises() -> None:
    svc, _, _ = _svc()
    with pytest.raises(MCPServiceError):
        await svc.invoke_server_tool("missing", tool_name="x", arguments={})


@pytest.mark.asyncio
async def test_invoke_adapter_error_wraps_to_service_error() -> None:
    adapter = FakeAdapter(raise_on="invoke")
    svc, _, _ = _svc(adapter=adapter)
    s = await svc.add(name="x", transport=MCPTransport.STDIO, config={"command": "echo"})
    with pytest.raises(MCPServiceError):
        await svc.invoke_server_tool(s.id, tool_name="x", arguments={})
