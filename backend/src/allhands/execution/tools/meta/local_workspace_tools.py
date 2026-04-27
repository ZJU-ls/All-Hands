"""Meta tools for local-workspace CRUD.

Mirrors ``api/routers/local_workspaces.py``. Each REST write has a semantic
twin so Lead Agent can do via chat what users do in the
``/settings/workspaces`` page (Tool First / L01).
"""

from __future__ import annotations

from allhands.core import Tool, ToolKind, ToolScope

LIST_LOCAL_WORKSPACES_TOOL = Tool(
    id="allhands.meta.list_local_workspaces",
    kind=ToolKind.META,
    name="list_local_workspaces",
    description=(
        "List configured local workspaces. The local-files skill can only read / "
        "write under one of these roots."
    ),
    input_schema={"type": "object", "properties": {}},
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

ADD_LOCAL_WORKSPACE_TOOL = Tool(
    id="allhands.meta.add_local_workspace",
    kind=ToolKind.META,
    name="add_local_workspace",
    description=(
        "Register a new local workspace. ``root_path`` must be an existing "
        "directory; symlinks are resolved. Default ``read_only=false``."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "root_path": {"type": "string"},
            "read_only": {"type": "boolean", "default": False},
            "denied_globs": {
                "type": "array",
                "items": {"type": "string"},
                "default": [],
            },
        },
        "required": ["name", "root_path"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=False,
)

UPDATE_LOCAL_WORKSPACE_TOOL = Tool(
    id="allhands.meta.update_local_workspace",
    kind=ToolKind.META,
    name="update_local_workspace",
    description="Update a local workspace's name / root_path / read_only / denied_globs.",
    input_schema={
        "type": "object",
        "properties": {
            "workspace_id": {"type": "string"},
            "name": {"type": "string"},
            "root_path": {"type": "string"},
            "read_only": {"type": "boolean"},
            "denied_globs": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["workspace_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=False,
)

REMOVE_LOCAL_WORKSPACE_TOOL = Tool(
    id="allhands.meta.remove_local_workspace",
    kind=ToolKind.META,
    name="remove_local_workspace",
    description="Remove a local workspace registration. Files on disk are NOT touched.",
    input_schema={
        "type": "object",
        "properties": {"workspace_id": {"type": "string"}},
        "required": ["workspace_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=False,
)


ALL_LOCAL_WORKSPACE_META_TOOLS = [
    LIST_LOCAL_WORKSPACES_TOOL,
    ADD_LOCAL_WORKSPACE_TOOL,
    UPDATE_LOCAL_WORKSPACE_TOOL,
    REMOVE_LOCAL_WORKSPACE_TOOL,
]
