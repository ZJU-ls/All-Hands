"""cockpit.* meta tool declarations — cockpit spec § 5 / § 11."""

from __future__ import annotations

from allhands.core import ToolKind, ToolScope
from allhands.execution.tools.meta.cockpit_tools import (
    ALL_COCKPIT_META_TOOLS,
    COCKPIT_GET_WORKSPACE_SUMMARY_TOOL,
    COCKPIT_PAUSE_ALL_RUNS_TOOL,
)


def test_two_tools_exported() -> None:
    assert len(ALL_COCKPIT_META_TOOLS) == 2
    ids = {t.id for t in ALL_COCKPIT_META_TOOLS}
    assert ids == {
        "allhands.meta.cockpit.get_workspace_summary",
        "allhands.meta.cockpit.pause_all_runs",
    }


def test_both_are_meta_kind() -> None:
    for t in ALL_COCKPIT_META_TOOLS:
        assert t.kind == ToolKind.META, t.id


def test_scope_contract() -> None:
    assert COCKPIT_GET_WORKSPACE_SUMMARY_TOOL.scope == ToolScope.READ
    assert COCKPIT_PAUSE_ALL_RUNS_TOOL.scope == ToolScope.IRREVERSIBLE


def test_confirmation_contract() -> None:
    # Spec § 5: get_workspace_summary does not confirm; pause_all_runs does.
    assert COCKPIT_GET_WORKSPACE_SUMMARY_TOOL.requires_confirmation is False
    assert COCKPIT_PAUSE_ALL_RUNS_TOOL.requires_confirmation is True


def test_summary_tool_takes_no_args() -> None:
    schema = COCKPIT_GET_WORKSPACE_SUMMARY_TOOL.input_schema
    assert schema["type"] == "object"
    assert schema["properties"] == {}
    assert schema.get("additionalProperties") is False


def test_pause_tool_requires_reason() -> None:
    schema = COCKPIT_PAUSE_ALL_RUNS_TOOL.input_schema
    assert schema["required"] == ["reason"]
    assert schema["properties"]["reason"]["type"] == "string"


def test_callable_names_match_spec() -> None:
    name_to_id = {t.name: t.id for t in ALL_COCKPIT_META_TOOLS}
    assert name_to_id == {
        "cockpit.get_workspace_summary": "allhands.meta.cockpit.get_workspace_summary",
        "cockpit.pause_all_runs": "allhands.meta.cockpit.pause_all_runs",
    }


def test_descriptions_tell_agent_when_to_use() -> None:
    # Spec § 10.5: descriptions must explain *when* to call. Guard against
    # regressions where someone strips the usage guidance into pure schema.
    summary_desc = COCKPIT_GET_WORKSPACE_SUMMARY_TOOL.description.lower()
    assert "what's running" in summary_desc or "workspace state" in summary_desc
    pause_desc = COCKPIT_PAUSE_ALL_RUNS_TOOL.description.lower()
    assert "emergency" in pause_desc
    assert "irreversible" in pause_desc
