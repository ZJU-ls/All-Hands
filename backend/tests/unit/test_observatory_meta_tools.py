"""Observatory meta tools — scope / description / schema / registration.

Spec `docs/specs/agent-design/2026-04-18-observatory.md` § 7.

Every tool must:
- be META kind
- carry the right scope (3 READ · all read-only post-Langfuse)
- follow V04 TodoWrite idiom (WHEN TO USE / WHEN NOT TO USE in description)
- be registered via discover_builtin_tools()

L01 REST parity: `query_traces` / `get_trace` / `get_status` each have a
matching REST endpoint under `/api/observatory/*`. The `bootstrap_now` tool
was deleted along with the embedded Langfuse stack in 2026-04-25.
"""

from __future__ import annotations

from allhands.core import ToolKind, ToolScope


def test_all_observatory_meta_tools_exported() -> None:
    from allhands.execution.tools.meta.observatory_tools import (
        ALL_OBSERVATORY_META_TOOLS,
    )

    ids = {t.id for t in ALL_OBSERVATORY_META_TOOLS}
    assert ids == {
        "allhands.meta.observatory.query_traces",
        "allhands.meta.observatory.get_trace",
        "allhands.meta.observatory.get_status",
    }


def test_scopes_match_spec() -> None:
    from allhands.execution.tools.meta.observatory_tools import (
        OBSERVATORY_GET_STATUS_TOOL,
        OBSERVATORY_GET_TRACE_TOOL,
        OBSERVATORY_QUERY_TRACES_TOOL,
    )

    for tool in (
        OBSERVATORY_QUERY_TRACES_TOOL,
        OBSERVATORY_GET_TRACE_TOOL,
        OBSERVATORY_GET_STATUS_TOOL,
    ):
        assert tool.kind == ToolKind.META, f"{tool.id} must be META kind"
        assert tool.scope == ToolScope.READ, (
            f"{tool.id} is a read-only observation · scope must stay READ so "
            f"the Lead Agent can call it without burning a Confirmation Gate slot"
        )
        assert tool.requires_confirmation is False


def test_descriptions_follow_v04_idiom() -> None:
    """Spec § 7.1: each description must teach when / when-not with inline params."""
    from allhands.execution.tools.meta.observatory_tools import (
        ALL_OBSERVATORY_META_TOOLS,
    )

    for tool in ALL_OBSERVATORY_META_TOOLS:
        desc_upper = tool.description.upper()
        assert "WHEN TO USE" in desc_upper, (
            f"{tool.id} description missing 'WHEN TO USE' block — V04 idiom "
            f"from spec § 7.1 is load-bearing for Lead's router to pick between "
            f"cockpit.get_workspace_summary and observatory.query_traces"
        )
        assert "WHEN NOT TO USE" in desc_upper, (
            f"{tool.id} description missing 'WHEN NOT TO USE' block — the "
            f"cost-control half of the idiom"
        )


def test_query_traces_schema_has_filter_params() -> None:
    from allhands.execution.tools.meta.observatory_tools import (
        OBSERVATORY_QUERY_TRACES_TOOL,
    )

    props = OBSERVATORY_QUERY_TRACES_TOOL.input_schema["properties"]
    for param in ("employee_id", "status", "since", "until", "limit"):
        assert param in props, (
            f"query_traces § 7 table requires '{param}' filter field — "
            f"without it Lead cannot answer scoped analytic questions"
        )
    assert set(props["status"]["enum"]) >= {"ok", "failed"}
    assert props["limit"]["maximum"] == 500


def test_get_trace_requires_trace_id() -> None:
    from allhands.execution.tools.meta.observatory_tools import (
        OBSERVATORY_GET_TRACE_TOOL,
    )

    schema = OBSERVATORY_GET_TRACE_TOOL.input_schema
    assert schema["required"] == ["trace_id"]
    assert schema["properties"]["trace_id"]["minLength"] == 1


def test_registered_in_discover_builtin_tools() -> None:
    from allhands.execution.registry import ToolRegistry
    from allhands.execution.tools import discover_builtin_tools

    reg = ToolRegistry()
    discover_builtin_tools(reg)

    registered = {t.id for t in reg.list_all()}
    for tool_id in (
        "allhands.meta.observatory.query_traces",
        "allhands.meta.observatory.get_trace",
        "allhands.meta.observatory.get_status",
    ):
        assert tool_id in registered, (
            f"{tool_id} not registered · add ALL_OBSERVATORY_META_TOOLS to "
            f"discover_builtin_tools() in execution/tools/__init__.py"
        )
