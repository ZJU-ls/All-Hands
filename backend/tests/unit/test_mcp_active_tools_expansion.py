"""Regression for "员工挂了 MCP server 但找不到 tools" (2026-04-28).

Root cause:
    The employee designer UI persists a mounted MCP server as a marker
    ``"mcp:<server_id>"`` in ``employee.tool_ids``. ``AgentLoop._build_bindings``
    looked that up in the registry, hit ``KeyError``, and silently skipped
    it — so the agent saw zero MCP tools even though the user had clearly
    mounted a server in the picker.

Fix:
    ``AgentLoop._active_tool_ids`` now expands any ``mcp:*`` markers into
    the universal dispatch pair (``list_mcp_server_tools`` +
    ``invoke_mcp_server_tool``) before binding. The agent can then list
    + invoke any mounted server's catalogue at runtime — single dispatch
    point, no per-tool ahead-of-time registration.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

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


# Patch AgentLoop so we can construct one without the full ctor wiring.
def _init_for_test(self: Any, emp: Employee, registry: ToolRegistry) -> Any:
    self._employee = emp
    self._tool_registry = registry
    self._runtime = None
    return self


AgentLoop._init_for_test = _init_for_test  # type: ignore[attr-defined]


def test_no_mcp_marker_passthrough() -> None:
    emp = _mk_employee(["allhands.builtin.fetch_url"])
    out = _loop(emp)._active_tool_ids()
    assert out == ["allhands.builtin.fetch_url"]


def test_mcp_marker_expands_to_dispatch_pair() -> None:
    emp = _mk_employee(["mcp:server-abc", "allhands.builtin.fetch_url"])
    out = _loop(emp)._active_tool_ids()
    # marker dropped, dispatch pair injected
    assert "mcp:server-abc" not in out
    assert "allhands.meta.list_mcp_server_tools" in out
    assert "allhands.meta.invoke_mcp_server_tool" in out
    # other ids preserved
    assert "allhands.builtin.fetch_url" in out


def test_multiple_mcp_markers_dedupe_dispatch_pair() -> None:
    emp = _mk_employee(["mcp:srv-1", "mcp:srv-2", "mcp:srv-3"])
    out = _loop(emp)._active_tool_ids()
    assert out.count("allhands.meta.list_mcp_server_tools") == 1
    assert out.count("allhands.meta.invoke_mcp_server_tool") == 1
    # all markers dropped
    assert not any(t.startswith("mcp:") for t in out)


def test_dispatcher_already_present_not_duplicated() -> None:
    emp = _mk_employee([
        "mcp:srv-1",
        "allhands.meta.invoke_mcp_server_tool",  # explicitly added
    ])
    out = _loop(emp)._active_tool_ids()
    assert out.count("allhands.meta.invoke_mcp_server_tool") == 1
    assert "allhands.meta.list_mcp_server_tools" in out
