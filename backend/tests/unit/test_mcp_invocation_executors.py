"""Pin: ``test_mcp_connection`` / ``list_mcp_server_tools`` / ``invoke_mcp_server_tool``
have real executors — not the ``_async_noop`` fallback.

Regression: before 2026-04-27 these tools were declared in
``ALL_MCP_SERVER_META_TOOLS`` but missing from ``READ_META_EXECUTORS``, so
``discover_builtin_tools`` registered them with ``_async_noop`` and Lead got
``{}`` back from every call. The fix wires ``build_mcp_invocation_executors``
into ``api/deps.get_tool_registry``.
"""

from __future__ import annotations

import pytest

from allhands.api.mcp_executors import build_mcp_invocation_executors
from allhands.core import MCPHealth, MCPServer, MCPTransport
from allhands.execution.mcp.adapter import MCPInvocationError, MCPToolInfo


class _FakeAdapter:
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
        self.invoke_result = invoke_result or {"ok": True}
        self.raise_on = raise_on
        self.last_invoked: tuple[str, dict[str, object]] | None = None

    async def handshake(self, server: MCPServer) -> MCPHealth:
        return self.health

    async def list_tools(self, server: MCPServer) -> list[MCPToolInfo]:
        if self.raise_on == "list_tools":
            raise MCPInvocationError("boom-list")
        return list(self.tools)

    async def invoke_tool(
        self,
        server: MCPServer,
        tool_name: str,
        arguments: dict[str, object],
    ) -> dict[str, object]:
        if self.raise_on == "invoke":
            raise MCPInvocationError("boom-invoke")
        self.last_invoked = (tool_name, dict(arguments))
        return dict(self.invoke_result)


class _InMemRepo:
    def __init__(self, seed: list[MCPServer]) -> None:
        self._data = {s.id: s for s in seed}

    async def get(self, server_id: str) -> MCPServer | None:
        return self._data.get(server_id)

    async def list_all(self) -> list[MCPServer]:
        return list(self._data.values())

    async def upsert(self, server: MCPServer) -> None:
        self._data[server.id] = server

    async def delete(self, server_id: str) -> None:
        self._data.pop(server_id, None)


def _server(server_id: str = "fs-1", name: str = "Filesystem") -> MCPServer:
    from datetime import UTC, datetime

    return MCPServer(
        id=server_id,
        name=name,
        transport=MCPTransport.STDIO,
        config={"command": "echo", "args": []},
        enabled=True,
        health=MCPHealth.UNKNOWN,
        last_handshake_at=None,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


class _Maker:
    """Stub async sessionmaker — the executors only use it via _session_context.
    We patch the service factory inside the executor module to swap our fake."""

    def __init__(self) -> None:
        self.calls = 0

    def __call__(self) -> _FakeSessionCM:
        self.calls += 1
        return _FakeSessionCM()


class _FakeSessionCM:
    async def __aenter__(self) -> _FakeSessionCM:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def begin(self) -> _BeginCM:
        return _BeginCM()

    async def commit(self) -> None:
        return None

    async def rollback(self) -> None:
        return None


class _BeginCM:
    async def __aenter__(self) -> _BeginCM:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None


def _make_executors_with(
    monkeypatch: pytest.MonkeyPatch,
    *,
    server: MCPServer,
    adapter: _FakeAdapter,
) -> dict[str, object]:
    """Build the executor bundle but force MCPService construction onto our
    in-mem repo + fake adapter."""
    from allhands.api import mcp_executors as mod

    repo = _InMemRepo([server])

    def _fake_service(session: object) -> object:  # type: ignore[no-redef]
        from allhands.services.mcp_service import MCPService

        return MCPService(repo=repo, adapter=adapter)  # type: ignore[arg-type]

    maker = _Maker()

    # Replace _service inside bundle closures by re-binding through monkeypatch:
    # simpler — patch SqlMCPServerRepo + adapter at module level so the closures
    # build a service against our in-mem repo / fake adapter.
    def _fake_repo_ctor(_session: object) -> object:
        return repo

    monkeypatch.setattr(mod, "SqlMCPServerRepo", _fake_repo_ctor)
    monkeypatch.setattr(mod, "RealMCPAdapter", lambda: adapter)
    # Re-build so the closure captures the patched adapter (RealMCPAdapter() ran
    # before monkeypatch). Returning the fresh bundle is enough.
    return mod.build_mcp_invocation_executors(maker)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_test_mcp_connection_returns_health(monkeypatch: pytest.MonkeyPatch) -> None:
    server = _server()
    bundle = _make_executors_with(
        monkeypatch,
        server=server,
        adapter=_FakeAdapter(health=MCPHealth.OK),
    )
    out = await bundle["allhands.meta.test_mcp_connection"](server_id="fs-1")  # type: ignore[operator]
    assert out["server_id"] == "fs-1"
    assert out["health"] == "ok"
    assert out["last_handshake_at"] is not None


@pytest.mark.asyncio
async def test_test_mcp_connection_unknown_server(monkeypatch: pytest.MonkeyPatch) -> None:
    bundle = _make_executors_with(
        monkeypatch,
        server=_server(),
        adapter=_FakeAdapter(),
    )
    out = await bundle["allhands.meta.test_mcp_connection"](server_id="missing")  # type: ignore[operator]
    assert "error" in out
    assert out["field"] == "server_id"


@pytest.mark.asyncio
async def test_list_mcp_server_tools_returns_tool_descriptors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tools = [
        MCPToolInfo(
            name="list_directory",
            description="List entries in a directory.",
            input_schema={"type": "object", "properties": {"path": {"type": "string"}}},
        ),
        MCPToolInfo(
            name="read_file",
            description="Read a file.",
            input_schema={"type": "object", "properties": {"path": {"type": "string"}}},
        ),
    ]
    bundle = _make_executors_with(
        monkeypatch,
        server=_server(),
        adapter=_FakeAdapter(tools=tools),
    )
    out = await bundle["allhands.meta.list_mcp_server_tools"](server_id="fs-1")  # type: ignore[operator]
    assert out["count"] == 2
    names = [t["name"] for t in out["tools"]]
    assert names == ["list_directory", "read_file"]
    # input_schema preserved (regression: empty-{} symptom from no-op fallback)
    assert out["tools"][0]["input_schema"]["properties"]["path"]["type"] == "string"


@pytest.mark.asyncio
async def test_list_mcp_server_tools_adapter_error_surfaces(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bundle = _make_executors_with(
        monkeypatch,
        server=_server(),
        adapter=_FakeAdapter(raise_on="list_tools"),
    )
    out = await bundle["allhands.meta.list_mcp_server_tools"](server_id="fs-1")  # type: ignore[operator]
    assert "error" in out
    assert "boom-list" in out["error"]
    assert "hint" in out


@pytest.mark.asyncio
async def test_invoke_mcp_server_tool_passes_arguments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = _FakeAdapter(invoke_result={"entries": ["a.txt", "b.txt"]})
    bundle = _make_executors_with(monkeypatch, server=_server(), adapter=adapter)
    out = await bundle["allhands.meta.invoke_mcp_server_tool"](  # type: ignore[operator]
        server_id="fs-1",
        tool_name="list_directory",
        arguments={"path": "/Users/me/Desktop"},
    )
    assert out["tool_name"] == "list_directory"
    assert out["result"] == {"entries": ["a.txt", "b.txt"]}
    assert adapter.last_invoked == ("list_directory", {"path": "/Users/me/Desktop"})


@pytest.mark.asyncio
async def test_invoke_handles_missing_arguments(monkeypatch: pytest.MonkeyPatch) -> None:
    adapter = _FakeAdapter()
    bundle = _make_executors_with(monkeypatch, server=_server(), adapter=adapter)
    out = await bundle["allhands.meta.invoke_mcp_server_tool"](  # type: ignore[operator]
        server_id="fs-1",
        tool_name="ping",
    )
    assert "error" not in out
    assert adapter.last_invoked == ("ping", {})


@pytest.mark.asyncio
async def test_invoke_adapter_error_returns_structured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bundle = _make_executors_with(
        monkeypatch,
        server=_server(),
        adapter=_FakeAdapter(raise_on="invoke"),
    )
    out = await bundle["allhands.meta.invoke_mcp_server_tool"](  # type: ignore[operator]
        server_id="fs-1",
        tool_name="list_directory",
        arguments={"path": "~/Desktop"},
    )
    assert "error" in out
    assert "boom-invoke" in out["error"]
    assert "hint" in out


def test_executors_bundle_covers_all_three_tool_ids() -> None:
    """Pin the contract: build_mcp_invocation_executors returns exactly the
    three tool ids that READ_META_EXECUTORS was missing. If anyone removes one
    by accident, this fails loudly instead of regressing to _async_noop."""

    class _Stub:
        def __call__(self) -> object:  # pragma: no cover - never invoked
            raise NotImplementedError

    bundle = build_mcp_invocation_executors(_Stub())  # type: ignore[arg-type]
    assert set(bundle.keys()) == {
        "allhands.meta.test_mcp_connection",
        "allhands.meta.list_mcp_server_tools",
        "allhands.meta.invoke_mcp_server_tool",
    }


def test_get_tool_registry_wires_real_executors_not_noop() -> None:
    """Static guard: registry returned by api.deps.get_tool_registry maps each
    of the three MCP-invocation tools to a callable whose qualname is NOT
    ``_async_noop``. Pre-fix this would land on the noop and Lead returned {}."""
    from allhands.api.deps import get_tool_registry

    reg = get_tool_registry()
    for tool_id in (
        "allhands.meta.test_mcp_connection",
        "allhands.meta.list_mcp_server_tools",
        "allhands.meta.invoke_mcp_server_tool",
    ):
        _, executor = reg.get(tool_id)
        qual = getattr(executor, "__qualname__", "") or ""
        assert "noop" not in qual.lower(), (
            f"{tool_id} executor still resolves to a noop ({qual!r}) — extra_executors not wired"
        )
