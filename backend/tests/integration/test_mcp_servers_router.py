"""End-to-end tests for /api/mcp-servers — router + service + repo + adapter.

Uses in-memory SQLite + a FakeAdapter override so we don't spawn real MCP
servers. Covers the full contract Lead Agent and UI rely on.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from allhands.api import create_app
from allhands.api.deps import get_mcp_service, get_session
from allhands.core import MCPHealth, MCPServer
from allhands.execution.mcp.adapter import MCPInvocationError, MCPToolInfo
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlMCPServerRepo
from allhands.services.mcp_service import MCPService


class FakeAdapter:
    def __init__(self) -> None:
        self.health = MCPHealth.OK
        self.tools: list[MCPToolInfo] = [
            MCPToolInfo(
                name="echo",
                description="echo back",
                input_schema={"type": "object", "properties": {"msg": {"type": "string"}}},
            ),
        ]
        self.invoke_result: dict[str, object] = {"result": "echoed"}
        self.raise_invoke = False

    async def handshake(self, server: MCPServer) -> MCPHealth:
        return self.health

    async def list_tools(self, server: MCPServer) -> list[MCPToolInfo]:
        return list(self.tools)

    async def invoke_tool(
        self,
        server: MCPServer,
        tool_name: str,
        arguments: dict[str, object],
    ) -> dict[str, object]:
        if self.raise_invoke:
            raise MCPInvocationError("forced failure")
        return dict(self.invoke_result) | {"tool": tool_name, "args": arguments}


@pytest.fixture
def adapter() -> FakeAdapter:
    return FakeAdapter()


@pytest.fixture
def client(adapter: FakeAdapter) -> TestClient:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    async def _session() -> AsyncIterator[AsyncSession]:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as s:
            yield s

    async def _mcp_service(session: AsyncSession = Depends(_session)) -> MCPService:
        return MCPService(repo=SqlMCPServerRepo(session), adapter=adapter)

    app = create_app()
    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_mcp_service] = _mcp_service
    return TestClient(app)


def test_list_empty(client: TestClient) -> None:
    r = client.get("/api/mcp-servers")
    assert r.status_code == 200
    assert r.json() == []


def test_add_stdio_server_returns_201_and_shape(client: TestClient) -> None:
    r = client.post(
        "/api/mcp-servers",
        json={
            "name": "s1",
            "transport": "stdio",
            "config": {"command": "echo", "args": ["hi"]},
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "s1"
    assert body["transport"] == "stdio"
    assert body["health"] == "unknown"
    assert body["enabled"] is True


def test_add_bad_transport_400(client: TestClient) -> None:
    r = client.post(
        "/api/mcp-servers",
        json={"name": "s", "transport": "ftp", "config": {}},
    )
    assert r.status_code == 400


def test_add_duplicate_name_400(client: TestClient) -> None:
    body = {"name": "dup", "transport": "stdio", "config": {"command": "echo"}}
    assert client.post("/api/mcp-servers", json=body).status_code == 201
    r = client.post("/api/mcp-servers", json=body)
    assert r.status_code == 400


def test_get_missing_404(client: TestClient) -> None:
    assert client.get("/api/mcp-servers/missing").status_code == 404


def test_update_enabled_and_config(client: TestClient) -> None:
    created = client.post(
        "/api/mcp-servers",
        json={"name": "s", "transport": "http", "config": {"url": "http://a"}},
    ).json()
    r = client.patch(
        f"/api/mcp-servers/{created['id']}",
        json={"enabled": False, "config": {"url": "http://b"}},
    )
    assert r.status_code == 200
    assert r.json()["enabled"] is False
    assert r.json()["config"] == {"url": "http://b"}


def test_delete_returns_204_and_removes(client: TestClient) -> None:
    created = client.post(
        "/api/mcp-servers",
        json={"name": "s", "transport": "stdio", "config": {"command": "echo"}},
    ).json()
    assert client.delete(f"/api/mcp-servers/{created['id']}").status_code == 204
    assert client.get(f"/api/mcp-servers/{created['id']}").status_code == 404


def test_test_connection_updates_health(client: TestClient, adapter: FakeAdapter) -> None:
    adapter.health = MCPHealth.OK
    created = client.post(
        "/api/mcp-servers",
        json={"name": "s", "transport": "stdio", "config": {"command": "echo"}},
    ).json()
    r = client.post(f"/api/mcp-servers/{created['id']}/test")
    assert r.status_code == 200
    assert r.json()["health"] == "ok"
    assert r.json()["last_handshake_at"] is not None


def test_test_connection_missing_404(client: TestClient) -> None:
    assert client.post("/api/mcp-servers/missing/test").status_code == 404


def test_list_server_tools(client: TestClient) -> None:
    created = client.post(
        "/api/mcp-servers",
        json={"name": "s", "transport": "stdio", "config": {"command": "echo"}},
    ).json()
    r = client.get(f"/api/mcp-servers/{created['id']}/tools")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["name"] == "echo"


def test_list_server_tools_missing_404(client: TestClient) -> None:
    assert client.get("/api/mcp-servers/missing/tools").status_code == 404


def test_invoke_tool_round_trip(client: TestClient) -> None:
    created = client.post(
        "/api/mcp-servers",
        json={"name": "s", "transport": "stdio", "config": {"command": "echo"}},
    ).json()
    r = client.post(
        f"/api/mcp-servers/{created['id']}/invoke",
        json={"tool_name": "echo", "arguments": {"msg": "hi"}},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["tool"] == "echo"
    assert data["args"] == {"msg": "hi"}


def test_invoke_adapter_error_502(client: TestClient, adapter: FakeAdapter) -> None:
    adapter.raise_invoke = True
    created = client.post(
        "/api/mcp-servers",
        json={"name": "s", "transport": "stdio", "config": {"command": "echo"}},
    ).json()
    r = client.post(
        f"/api/mcp-servers/{created['id']}/invoke",
        json={"tool_name": "echo", "arguments": {}},
    )
    assert r.status_code == 502
