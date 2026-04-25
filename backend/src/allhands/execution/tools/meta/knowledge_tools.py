"""Knowledge Base meta tools — agent-driven CRUD + search.

Tool-First (Principle 1): every UI button on /knowledge has a same-name
Meta Tool. Read tools auto-execute (scope=READ); write tools require
confirmation (scope=WRITE) and additionally fail-fast with
``GrantDenied`` when the calling employee/skill has no grant.

Confirmation copy mirrors the Artifact tools: tell the user what is
about to change before calling, then call.
"""

from __future__ import annotations

from allhands.core import Tool, ToolKind, ToolScope

# ── READ tools (executors registered in api/app.py via extra_executors)

KB_LIST_EMBEDDING_MODELS_TOOL = Tool(
    id="allhands.kb.list_embedding_models",
    kind=ToolKind.META,
    name="kb_list_embedding_models",
    description=(
        "List embedding models that can be used for KB creation. Returns "
        "`{models: [{ref, label, dim, available, reason, is_default}]}`. "
        "Use before `kb_create_document` flows that involve creating a new "
        "KB so the user picks an embedding model that's actually usable in "
        "this deployment (e.g. openai needs an API key)."
    ),
    input_schema={"type": "object", "properties": {}},
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)


KB_LIST_TOOL = Tool(
    id="allhands.kb.list",
    kind=ToolKind.META,
    name="kb_list",
    description=(
        "List the knowledge bases in the current workspace. "
        "Returns `{kbs: [{id, name, doc_count, chunk_count, embedding_model_ref}]}`. "
        "Call this first when you need to know which KB to search."
    ),
    input_schema={"type": "object", "properties": {}},
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)


KB_BROWSE_COLLECTION_TOOL = Tool(
    id="allhands.kb.browse_collection",
    kind=ToolKind.META,
    name="kb_browse_collection",
    description=(
        "List documents in a KB, optionally filtered by collection / state / "
        "title prefix / tag. Returns `{documents: [...]}`. Use to discover "
        "what's in a KB before searching, or to enumerate by tag/folder."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "kb_id": {"type": "string"},
            "collection_id": {"type": "string"},
            "title_prefix": {"type": "string"},
            "tag": {"type": "string"},
            "state": {
                "type": "string",
                "enum": ["pending", "parsing", "chunking", "indexing", "ready", "failed"],
            },
            "limit": {"type": "integer", "minimum": 1, "maximum": 500, "default": 50},
            "offset": {"type": "integer", "minimum": 0, "default": 0},
        },
        "required": ["kb_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)


KB_SEARCH_TOOL = Tool(
    id="allhands.kb.search",
    kind=ToolKind.META,
    name="kb_search",
    description=(
        "Hybrid search (BM25 + vector + RRF) inside a KB. Returns "
        "`{results: [{chunk_id, doc_id, score, text, citation, "
        "section_path, page}]}`. Call this to retrieve passages relevant "
        "to a question before answering. Then optionally call "
        "`kb_read_document` to expand the source."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "kb_id": {"type": "string"},
            "query": {"type": "string"},
            "top_k": {"type": "integer", "minimum": 1, "maximum": 50},
        },
        "required": ["kb_id", "query"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)


KB_READ_DOCUMENT_TOOL = Tool(
    id="allhands.kb.read_document",
    kind=ToolKind.META,
    name="kb_read_document",
    description=(
        "Read a document's full text content. Use after `kb_search` if "
        "the chunk preview isn't enough. For very large docs the result is "
        "truncated; you can call again with a section/span window once the "
        "chunker exposes one."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "document_id": {"type": "string"},
            "max_chars": {"type": "integer", "minimum": 200, "maximum": 200000, "default": 20000},
        },
        "required": ["document_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)


# ── WRITE tools (require confirmation; agent path also needs grant)

KB_CREATE_DOCUMENT_TOOL = Tool(
    id="allhands.kb.create_document",
    kind=ToolKind.META,
    name="kb_create_document",
    description=(
        "Create a new document in a KB by inlining text content. Triggers "
        "the full ingest (parse → chunk → embed → index). "
        "**Requires a write grant** for this employee/skill on the target "
        "KB; if missing the call returns an error and the user is prompted "
        "to grant inline. **Pops a confirmation dialog** describing the new "
        "document — tell the user what you're about to add."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "kb_id": {"type": "string"},
            "title": {"type": "string"},
            "content": {"type": "string", "description": "Document content (text or markdown)."},
            "mime_type": {
                "type": "string",
                "description": "Optional override; defaults to text/markdown.",
            },
            "tags": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["kb_id", "title", "content"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)


KB_GRANT_PERMISSION_TOOL = Tool(
    id="allhands.kb.grant_permission",
    kind=ToolKind.META,
    name="kb_grant_permission",
    description=(
        "Grant a write/admin permission on a KB to an employee or skill. "
        "Used by the user (via Lead) to authorize an agent's write access. "
        "Pops a confirmation dialog showing scope + expiry."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "kb_id": {"type": "string"},
            "scope": {"type": "string", "enum": ["read", "write", "admin"]},
            "employee_id": {"type": "string"},
            "skill_id": {"type": "string"},
            "expires_at": {
                "type": "string",
                "description": "ISO timestamp; null = never expires.",
            },
        },
        "required": ["kb_id", "scope"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)


ALL_KB_META_TOOLS = [
    KB_LIST_TOOL,
    KB_LIST_EMBEDDING_MODELS_TOOL,
    KB_BROWSE_COLLECTION_TOOL,
    KB_SEARCH_TOOL,
    KB_READ_DOCUMENT_TOOL,
    KB_CREATE_DOCUMENT_TOOL,
    KB_GRANT_PERMISSION_TOOL,
]


__all__ = [
    "ALL_KB_META_TOOLS",
    "KB_BROWSE_COLLECTION_TOOL",
    "KB_CREATE_DOCUMENT_TOOL",
    "KB_GRANT_PERMISSION_TOOL",
    "KB_LIST_EMBEDDING_MODELS_TOOL",
    "KB_LIST_TOOL",
    "KB_READ_DOCUMENT_TOOL",
    "KB_SEARCH_TOOL",
]
