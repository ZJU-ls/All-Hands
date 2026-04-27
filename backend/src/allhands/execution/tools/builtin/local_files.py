"""Tool declarations for ``allhands.local-files`` skill — Claude Code-like
local file capability.

Seven tools: read_file / list_directory / glob / grep / write_file / edit_file
/ bash. All gated by a configured ``LocalWorkspace`` (see
``allhands.services.local_workspace_service``). Executors live in
``api/local_files_executors.py`` because they close over
``LocalWorkspaceService`` (execution → services would violate the layered
import-linter contract).

v1 권한 posture (2026-04-27):
- READ tools (read_file / list_directory / glob / grep): no confirmation
- WRITE tools (write_file / edit_file): no confirmation
- bash: no confirmation EXCEPT when its command body matches the destructive
  regex set inside ``api/local_files_executors._is_destructive``. The Tool
  itself declares ``requires_confirmation=False`` because the gate decision
  is dynamic per-call (only some commands defer); the Defer is raised by
  the executor at call-time, not by the static gate.
"""

from __future__ import annotations

from allhands.core import CostHint, Tool, ToolKind, ToolScope

WORKSPACE_ID_FIELD = {
    "type": "string",
    "description": (
        "ID of the workspace to operate in. Use list_local_workspaces to get the id. "
        "If omitted and exactly one workspace exists, it is used."
    ),
}

PATH_FIELD = {
    "type": "string",
    "description": (
        "File path. Either absolute or relative to the workspace root. "
        "Must resolve inside the workspace root after symlink expansion."
    ),
}


READ_FILE_TOOL = Tool(
    id="allhands.local.read_file",
    kind=ToolKind.BACKEND,
    name="read_file",
    description=(
        "Read a text file from the workspace. Returns content with cat -n line "
        "numbers, plus line_count and truncated flag. Default reads up to 2000 "
        "lines from the start. Use offset+limit for large files."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "workspace_id": WORKSPACE_ID_FIELD,
            "path": PATH_FIELD,
            "offset": {"type": "integer", "minimum": 0, "default": 0},
            "limit": {"type": "integer", "minimum": 1, "maximum": 5000, "default": 2000},
        },
        "required": ["path"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


LIST_DIRECTORY_TOOL = Tool(
    id="allhands.local.list_directory",
    kind=ToolKind.BACKEND,
    name="list_directory",
    description=(
        "List a single directory's entries (non-recursive). Returns "
        "[{name, type, size, mtime}] where type is file|dir|symlink. "
        "Use glob for recursive pattern matching."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "workspace_id": WORKSPACE_ID_FIELD,
            "path": {**PATH_FIELD, "default": "."},
        },
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


GLOB_TOOL = Tool(
    id="allhands.local.glob",
    kind=ToolKind.BACKEND,
    name="glob",
    description=(
        "Match files by glob pattern. Supports ** for recursion. "
        "Returns up to 200 paths sorted by mtime descending."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "workspace_id": WORKSPACE_ID_FIELD,
            "pattern": {
                "type": "string",
                "description": "Glob pattern, e.g. '**/*.py' or 'src/**/test_*.py'.",
            },
            "path": {**PATH_FIELD, "default": "."},
        },
        "required": ["pattern"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


GREP_TOOL = Tool(
    id="allhands.local.grep",
    kind=ToolKind.BACKEND,
    name="grep",
    description=(
        "Search file contents with ripgrep-style regex. output_mode is one of "
        "files_with_matches (default) | content | count. Use -i for case-insensitive, "
        "-n for line numbers, -A/-B/-C for context. Constrain scope with `path` and "
        "`glob` to keep results tractable."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "workspace_id": WORKSPACE_ID_FIELD,
            "pattern": {"type": "string"},
            "path": {**PATH_FIELD, "default": "."},
            "glob": {"type": "string"},
            "output_mode": {
                "type": "string",
                "enum": ["files_with_matches", "content", "count"],
                "default": "files_with_matches",
            },
            "-i": {"type": "boolean", "default": False},
            "-n": {"type": "boolean", "default": False},
            "-A": {"type": "integer", "minimum": 0, "maximum": 50},
            "-B": {"type": "integer", "minimum": 0, "maximum": 50},
            "-C": {"type": "integer", "minimum": 0, "maximum": 50},
            "head_limit": {"type": "integer", "minimum": 1, "default": 100},
        },
        "required": ["pattern"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


WRITE_LOCAL_FILE_TOOL = Tool(
    id="allhands.local.write_file",
    kind=ToolKind.BACKEND,
    name="write_local_file",
    description=(
        "Overwrite a file in the workspace with new content. For an existing file "
        "you must read_file it first in this conversation — otherwise the call is "
        "rejected with a 'must read before overwriting' error. New files do not "
        "require this. Parent directories are created as needed."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "workspace_id": WORKSPACE_ID_FIELD,
            "path": PATH_FIELD,
            "content": {"type": "string"},
        },
        "required": ["path", "content"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


EDIT_FILE_TOOL = Tool(
    id="allhands.local.edit_file",
    kind=ToolKind.BACKEND,
    name="edit_file",
    description=(
        "Replace a unique substring in an existing file. old_string must occur "
        "exactly once unless replace_all=true. The file must have been read in "
        "this conversation first. Whitespace and newlines must match exactly."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "workspace_id": WORKSPACE_ID_FIELD,
            "path": PATH_FIELD,
            "old_string": {"type": "string"},
            "new_string": {"type": "string"},
            "replace_all": {"type": "boolean", "default": False},
        },
        "required": ["path", "old_string", "new_string"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


BASH_TOOL = Tool(
    id="allhands.local.bash",
    kind=ToolKind.BACKEND,
    name="bash",
    description=(
        "Run a shell command with cwd locked to the workspace root (or a "
        "subdirectory inside it). stdout/stderr are returned, each capped at 30KB "
        "with head/tail kept. Default timeout 120s, max 600s. Destructive commands "
        "(rm/rmdir/mv outside/git reset --hard/etc.) are deferred for user "
        "confirmation; non-destructive commands run immediately."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "workspace_id": WORKSPACE_ID_FIELD,
            "command": {"type": "string"},
            "cwd": {
                **PATH_FIELD,
                "description": "Subdirectory inside the workspace; default is workspace root.",
            },
            "timeout_ms": {
                "type": "integer",
                "minimum": 1000,
                "maximum": 600000,
                "default": 120000,
            },
        },
        "required": ["command"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.IRREVERSIBLE,
    requires_confirmation=False,
    cost_hint=CostHint(relative="medium"),
)


ALL_LOCAL_FILE_TOOLS = [
    READ_FILE_TOOL,
    LIST_DIRECTORY_TOOL,
    GLOB_TOOL,
    GREP_TOOL,
    WRITE_LOCAL_FILE_TOOL,
    EDIT_FILE_TOOL,
    BASH_TOOL,
]
