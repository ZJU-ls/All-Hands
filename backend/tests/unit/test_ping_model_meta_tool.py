"""Unit tests for the ping_model meta tool (I-0019 · L01 pair).

The /gateway page exposes a per-model [ping] button that POSTs
`/api/models/{id}/ping`. Tool First (L01 · 2026-04-18 扩展版) requires a
symmetrical meta tool so the Lead Agent can do the same thing in chat:
`ping_model(model_id)` → `{ok, latency_ms, ...}`.

This file only pins the *declaration* contract (schema, scope, registration).
The actual execution path is the REST handler; meta tools are contract
stubs registered with the no-op executor in discover_builtin_tools().
"""

from __future__ import annotations

from allhands.core import ToolKind, ToolScope


def test_ping_model_tool_exported() -> None:
    from allhands.execution.tools.meta.model_tools import (
        ALL_MODEL_META_TOOLS,
        PING_MODEL_TOOL,
    )

    assert PING_MODEL_TOOL in ALL_MODEL_META_TOOLS
    assert PING_MODEL_TOOL.id == "allhands.meta.ping_model"


def test_ping_model_tool_kind_is_meta() -> None:
    from allhands.execution.tools.meta.model_tools import PING_MODEL_TOOL

    assert PING_MODEL_TOOL.kind == ToolKind.META


def test_ping_model_tool_is_read_scope_no_confirmation() -> None:
    """ping is a healthcheck — it doesn't mutate state. READ · no gate."""
    from allhands.execution.tools.meta.model_tools import PING_MODEL_TOOL

    assert PING_MODEL_TOOL.scope == ToolScope.READ
    assert PING_MODEL_TOOL.requires_confirmation is False


def test_ping_model_tool_requires_model_id() -> None:
    from allhands.execution.tools.meta.model_tools import PING_MODEL_TOOL

    required = PING_MODEL_TOOL.input_schema.get("required", [])
    assert "model_id" in required
    # model_id is the only required arg — everything else derives from the model
    assert required == ["model_id"]


def test_ping_model_tool_registered_in_discover_builtin_tools() -> None:
    from allhands.execution.registry import ToolRegistry
    from allhands.execution.tools import discover_builtin_tools

    reg = ToolRegistry()
    discover_builtin_tools(reg)

    registered_ids = {t.id for t in reg.list_all()}
    assert "allhands.meta.ping_model" in registered_ids, (
        "allhands.meta.ping_model not registered — add PING_MODEL_TOOL to "
        "ALL_MODEL_META_TOOLS in execution/tools/meta/model_tools.py"
    )


def test_ping_model_tool_description_mentions_latency_and_ping() -> None:
    """Description is what the Lead Agent sees — it must signal intent clearly."""
    from allhands.execution.tools.meta.model_tools import PING_MODEL_TOOL

    desc = PING_MODEL_TOOL.description.lower()
    assert "ping" in desc or "connectivity" in desc or "health" in desc
    assert "latency" in desc or "ms" in desc
