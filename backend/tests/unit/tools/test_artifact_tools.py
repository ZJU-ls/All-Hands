"""artifact_* meta tool declarations (Wave C · artifacts-skill spec § 11)."""

from __future__ import annotations

from allhands.core import ToolKind, ToolScope
from allhands.execution.tools.meta.artifact_tools import (
    ALL_ARTIFACT_TOOLS,
    ARTIFACT_CREATE_TOOL,
    ARTIFACT_DELETE_TOOL,
    ARTIFACT_LIST_TOOL,
    ARTIFACT_PIN_TOOL,
    ARTIFACT_READ_TOOL,
    ARTIFACT_RENDER_TOOL,
    ARTIFACT_SEARCH_TOOL,
    ARTIFACT_UPDATE_TOOL,
)


def test_all_eight_tools_exported() -> None:
    assert len(ALL_ARTIFACT_TOOLS) == 8
    ids = {t.id for t in ALL_ARTIFACT_TOOLS}
    assert ids == {
        "allhands.artifacts.create",
        "allhands.artifacts.list",
        "allhands.artifacts.read",
        "allhands.artifacts.render",
        "allhands.artifacts.update",
        "allhands.artifacts.delete",
        "allhands.artifacts.pin",
        "allhands.artifacts.search",
    }


def test_tools_are_meta_kind() -> None:
    for tool in ALL_ARTIFACT_TOOLS:
        assert tool.kind == ToolKind.META, tool.id


def test_scope_contract() -> None:
    assert ARTIFACT_CREATE_TOOL.scope == ToolScope.WRITE
    assert ARTIFACT_UPDATE_TOOL.scope == ToolScope.WRITE
    assert ARTIFACT_PIN_TOOL.scope == ToolScope.WRITE
    assert ARTIFACT_DELETE_TOOL.scope == ToolScope.IRREVERSIBLE
    for read_tool in (
        ARTIFACT_LIST_TOOL,
        ARTIFACT_READ_TOOL,
        ARTIFACT_RENDER_TOOL,
        ARTIFACT_SEARCH_TOOL,
    ):
        assert read_tool.scope == ToolScope.READ, read_tool.id


def test_confirmation_contract() -> None:
    # Spec § 2.3: update + delete require confirmation; rest do not.
    assert ARTIFACT_UPDATE_TOOL.requires_confirmation is True
    assert ARTIFACT_DELETE_TOOL.requires_confirmation is True
    for no_confirm_tool in (
        ARTIFACT_CREATE_TOOL,
        ARTIFACT_LIST_TOOL,
        ARTIFACT_READ_TOOL,
        ARTIFACT_RENDER_TOOL,
        ARTIFACT_PIN_TOOL,
        ARTIFACT_SEARCH_TOOL,
    ):
        assert no_confirm_tool.requires_confirmation is False, no_confirm_tool.id


def test_create_schema_shape() -> None:
    schema = ARTIFACT_CREATE_TOOL.input_schema
    assert schema["required"] == ["name", "kind"]
    props = schema["properties"]
    assert set(props["kind"]["enum"]) == {
        "markdown",
        "code",
        "html",
        "image",
        "data",
        "mermaid",
    }
    assert "content" in props
    assert "content_base64" in props


def test_update_schema_has_mode_enum() -> None:
    props = ARTIFACT_UPDATE_TOOL.input_schema["properties"]
    assert props["mode"]["enum"] == ["overwrite", "patch"]
    assert ARTIFACT_UPDATE_TOOL.input_schema["required"] == ["artifact_id"]


def test_list_and_search_schemas() -> None:
    list_props = ARTIFACT_LIST_TOOL.input_schema["properties"]
    assert "pinned" in list_props
    assert list_props["limit"]["maximum"] == 500

    search_props = ARTIFACT_SEARCH_TOOL.input_schema["properties"]
    assert ARTIFACT_SEARCH_TOOL.input_schema["required"] == ["query"]
    assert search_props["limit"]["maximum"] == 200


def test_render_schema_targets_artifact_id() -> None:
    assert ARTIFACT_RENDER_TOOL.input_schema["required"] == ["artifact_id"]


def test_names_match_tool_registry_convention() -> None:
    # name is the function-call identifier; id is the registry key.
    name_to_id = {t.name: t.id for t in ALL_ARTIFACT_TOOLS}
    assert name_to_id == {
        "artifact_create": "allhands.artifacts.create",
        "artifact_list": "allhands.artifacts.list",
        "artifact_read": "allhands.artifacts.read",
        "artifact_render": "allhands.artifacts.render",
        "artifact_update": "allhands.artifacts.update",
        "artifact_delete": "allhands.artifacts.delete",
        "artifact_pin": "allhands.artifacts.pin",
        "artifact_search": "allhands.artifacts.search",
    }
