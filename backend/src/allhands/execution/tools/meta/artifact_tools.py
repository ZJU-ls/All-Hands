"""Artifact family meta tools — agent-driven CRUD over the artifact store.

See `docs/specs/agent-design/2026-04-18-artifacts-skill.md` § 4.

Confirmation policy:
- `create` / `pin` / `list` / `read` / `render` / `search` — no confirmation.
  Creates a new resource; does not overwrite prior work.
- `update` — **requires confirmation**. Overwrites a user-facing asset; the
  confirmation dialog shows the diff so the user can approve the change.
- `delete` — `IRREVERSIBLE` + **requires confirmation**. Even soft delete is
  treated as irreversible so the UX keeps its seriousness.

These declarations mirror the Claude Code Edit tool's contract: the agent
submits the target + the change, the user reviews the diff.
"""

from __future__ import annotations

from allhands.core import Tool, ToolKind, ToolScope

_KIND_ENUM = ["markdown", "code", "html", "image", "data", "mermaid"]

ARTIFACT_CREATE_TOOL = Tool(
    id="allhands.artifacts.create",
    kind=ToolKind.META,
    name="artifact_create",
    description=(
        "Create a new artifact in the workspace. TEXT kinds (markdown / code / html / "
        "data / mermaid) use `content`; IMAGE uses `content_base64`. Returns "
        "`{artifact_id, version}`. After creating, call artifact_render(id) to show the "
        "user a preview — do NOT paste the content back into the reply."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "User-facing title. 1-256 chars, letters/digits/CJK/space/._-.",
            },
            "kind": {"type": "string", "enum": _KIND_ENUM},
            "content": {
                "type": "string",
                "description": "Text content for TEXT kinds (required unless kind=image).",
            },
            "content_base64": {
                "type": "string",
                "description": "Base64-encoded binary for IMAGE kind.",
            },
            "mime_type": {
                "type": "string",
                "description": "Override mime_type; defaults from kind (e.g. text/markdown).",
            },
        },
        "required": ["name", "kind"],
    },
    output_schema={
        "type": "object",
        "properties": {
            "artifact_id": {"type": "string"},
            "version": {"type": "integer"},
        },
    },
    scope=ToolScope.WRITE,
    requires_confirmation=False,
)

ARTIFACT_LIST_TOOL = Tool(
    id="allhands.artifacts.list",
    kind=ToolKind.META,
    name="artifact_list",
    description=(
        "List artifacts in the current workspace, newest first (pinned always on top). "
        "Filter by `kind`, `name_prefix`, or `pinned=true`. Returns `{artifacts: [...]}"
        "` with id / name / kind / version / size / updated_at."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": _KIND_ENUM},
            "name_prefix": {"type": "string"},
            "pinned": {"type": "boolean"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 500, "default": 100},
            "include_deleted": {"type": "boolean", "default": False},
        },
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

ARTIFACT_READ_TOOL = Tool(
    id="allhands.artifacts.read",
    kind=ToolKind.META,
    name="artifact_read",
    description=(
        "Read artifact content into the agent's context. TEXT kinds return raw content; "
        "IMAGE returns base64 (truncated with a summary if > 256 KB). Use this when the "
        "user asks you to iterate on an earlier artifact."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "artifact_id": {"type": "string"},
            "version": {
                "type": "integer",
                "minimum": 1,
                "description": "Optional — defaults to latest version.",
            },
        },
        "required": ["artifact_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

ARTIFACT_RENDER_TOOL = Tool(
    id="allhands.artifacts.render",
    kind=ToolKind.META,
    name="artifact_render",
    description=(
        "Emit an `Artifact.Preview` render payload in the chat so the user sees the "
        "artifact without the full content hitting the agent's context. Call this after "
        "every create / update."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "artifact_id": {"type": "string"},
            "version": {
                "type": "integer",
                "minimum": 1,
                "description": "Optional — defaults to latest version.",
            },
        },
        "required": ["artifact_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

ARTIFACT_UPDATE_TOOL = Tool(
    id="allhands.artifacts.update",
    kind=ToolKind.META,
    name="artifact_update",
    description=(
        "Update an existing artifact. `mode='overwrite'` replaces content wholesale; "
        "`mode='patch'` applies a unified diff (TEXT kinds only). Version increments by 1; "
        "previous version is preserved. **Will pop a confirmation dialog with diff** — "
        "tell the user what changed before calling."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "artifact_id": {"type": "string"},
            "mode": {"type": "string", "enum": ["overwrite", "patch"], "default": "overwrite"},
            "content": {"type": "string"},
            "content_base64": {"type": "string"},
            "patch": {
                "type": "string",
                "description": "Unified diff format when mode='patch'.",
            },
        },
        "required": ["artifact_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

ARTIFACT_DELETE_TOOL = Tool(
    id="allhands.artifacts.delete",
    kind=ToolKind.META,
    name="artifact_delete",
    description=(
        "Soft-delete an artifact. The artifact is hidden from lists but retained for 30 "
        "days. **IRREVERSIBLE** from the user's perspective — pops a confirmation. Only "
        "call when the user explicitly asks to remove something."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "artifact_id": {"type": "string"},
        },
        "required": ["artifact_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.IRREVERSIBLE,
    requires_confirmation=True,
)

ARTIFACT_PIN_TOOL = Tool(
    id="allhands.artifacts.pin",
    kind=ToolKind.META,
    name="artifact_pin",
    description=(
        "Toggle the pinned flag on an artifact. Pinned artifacts stay at the top of the "
        "panel regardless of age. `pinned=false` unpins."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "artifact_id": {"type": "string"},
            "pinned": {"type": "boolean", "default": True},
        },
        "required": ["artifact_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=False,
)

ARTIFACT_SEARCH_TOOL = Tool(
    id="allhands.artifacts.search",
    kind=ToolKind.META,
    name="artifact_search",
    description=(
        "Full-text search over artifact names and TEXT-kind content within the current "
        "workspace. Returns `{artifacts: [...]}` with matching ids, ordered by recency."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "query": {"type": "string"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
        },
        "required": ["query"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)


ALL_ARTIFACT_TOOLS = [
    ARTIFACT_CREATE_TOOL,
    ARTIFACT_LIST_TOOL,
    ARTIFACT_READ_TOOL,
    ARTIFACT_RENDER_TOOL,
    ARTIFACT_UPDATE_TOOL,
    ARTIFACT_DELETE_TOOL,
    ARTIFACT_PIN_TOOL,
    ARTIFACT_SEARCH_TOOL,
]
