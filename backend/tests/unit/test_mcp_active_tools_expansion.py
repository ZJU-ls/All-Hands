"""Regression for "员工挂了 MCP server 但找不到 tools".

Original (2026-04-28) fix replaced ``mcp:<server_id>`` markers with a
universal dispatcher pair (``list_mcp_server_tools`` +
``invoke_mcp_server_tool``). That worked but the LLM had to do a
"first list, then invoke" two-turn dance most prompts skipped — agents
routinely told the user "我没有相关工具" even though the server was
mounted and healthy.

2026-04-29 rewrite (Claude Code V06 design):
    Each MCP server's tools are registered as concrete entries
    (``mcp__<server>__<tool>``) when the server is added / probed.
    ``_active_tool_ids`` resolves ``mcp:<server_id>`` markers by asking
    the MCPClient which concrete tool ids belong to that server. The
    agent sees specific tool names + schemas and can call them directly
    — no two-turn dance, no schema-less dispatcher.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from allhands.core import Employee
from allhands.execution.agent_loop import AgentLoop
from allhands.execution.registry import ToolRegistry


def _mk_employee(tool_ids: list[str]) -> Employee:
    return Employee(
        id="emp-test",
        name="Tester",
        description="",
        system_prompt="be helpful",
        model_ref="openai/gpt-4o-mini",
        tool_ids=tool_ids,
        skill_ids=[],
        max_iterations=5,
        created_by="user",
        created_at=datetime.now(UTC),
    )


def _loop(emp: Employee) -> Any:
    """Build a minimal AgentLoop instance just to exercise ``_active_tool_ids``."""
    registry = ToolRegistry()
    return AgentLoop.__new__(  # type: ignore[call-arg]
        AgentLoop,
    )._init_for_test(emp, registry)


def _init_for_test(self: Any, emp: Employee, registry: ToolRegistry) -> Any:
    self._employee = emp
    self._tool_registry = registry
    self._runtime = None
    return self


AgentLoop._init_for_test = _init_for_test  # type: ignore[attr-defined]


class _StubMCPClient:
    """Mimic the parts of MCPClient ``_active_tool_ids`` consumes."""

    def __init__(self, server_to_tools: dict[str, list[str]]) -> None:
        self._map = server_to_tools

    def tool_ids_for_server(self, server_id: str) -> list[str]:
        return list(self._map.get(server_id, []))


@pytest.fixture
def patch_client(monkeypatch: pytest.MonkeyPatch):
    """Hand the loop a stub MCPClient so the test never touches stdio."""
    from allhands.execution import mcp_client as mcp_client_module

    def _factory(server_to_tools: dict[str, list[str]]) -> _StubMCPClient:
        stub = _StubMCPClient(server_to_tools)
        monkeypatch.setattr(
            mcp_client_module,
            "get_default_mcp_client",
            lambda: stub,
        )
        return stub

    return _factory


def test_no_mcp_marker_passthrough(patch_client) -> None:
    patch_client({})
    emp = _mk_employee(["allhands.builtin.fetch_url"])
    out = _loop(emp)._active_tool_ids()
    assert out == ["allhands.builtin.fetch_url"]


def test_mcp_marker_expands_to_concrete_tool_ids(patch_client) -> None:
    """Single mounted server with three tools · marker → 3 concrete ids."""
    patch_client(
        {
            "server-abc": [
                "mcp__github__create_issue",
                "mcp__github__list_issues",
                "mcp__github__get_pr",
            ]
        }
    )
    emp = _mk_employee(["mcp:server-abc", "allhands.builtin.fetch_url"])
    out = _loop(emp)._active_tool_ids()
    # marker is gone
    assert "mcp:server-abc" not in out
    # concrete tools land
    assert "mcp__github__create_issue" in out
    assert "mcp__github__list_issues" in out
    assert "mcp__github__get_pr" in out
    # ordinary id preserved
    assert "allhands.builtin.fetch_url" in out
    # legacy dispatcher pair must NOT be auto-injected anymore
    assert "allhands.meta.list_mcp_server_tools" not in out
    assert "allhands.meta.invoke_mcp_server_tool" not in out


def test_multiple_mcp_servers_each_expand(patch_client) -> None:
    patch_client(
        {
            "srv-1": ["mcp__filesystem__read_file"],
            "srv-2": ["mcp__github__create_issue"],
        }
    )
    emp = _mk_employee(["mcp:srv-1", "mcp:srv-2"])
    out = _loop(emp)._active_tool_ids()
    assert "mcp__filesystem__read_file" in out
    assert "mcp__github__create_issue" in out
    assert not any(t.startswith("mcp:") for t in out)


def test_marker_for_unregistered_server_silently_drops(patch_client) -> None:
    """Server hasn't been handshaken (uvicorn restart, fresh worker) ·
    marker drops to nothing rather than poisoning the tool list with a
    non-existent id. AgentLoop logs a warning so ops can spot it."""
    patch_client({"srv-known": ["mcp__a__do"]})
    emp = _mk_employee(["mcp:srv-unknown"])
    out = _loop(emp)._active_tool_ids()
    assert out == []


def test_marker_dedupe_against_explicit_concrete_id(patch_client) -> None:
    """If the employee somehow already lists the concrete id explicitly,
    the marker expansion must not produce a duplicate."""
    patch_client({"srv-1": ["mcp__a__do"]})
    emp = _mk_employee(["mcp__a__do", "mcp:srv-1"])
    out = _loop(emp)._active_tool_ids()
    assert out.count("mcp__a__do") == 1
