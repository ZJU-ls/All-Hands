"""Meta tools for skill management.

Mirror `api/routers/skills.py` — each REST write must have a semantic twin here
so Lead Agent can do via chat what users do in the `/skills` UI. `upload` stays
REST-only because transferring .zip bytes through Lead Agent is awkward.
"""

from __future__ import annotations

from allhands.core import Tool, ToolKind, ToolScope

LIST_SKILLS_TOOL = Tool(
    id="allhands.meta.list_skills",
    kind=ToolKind.META,
    name="list_skills",
    description="List all installed skills with name/version/source.",
    input_schema={"type": "object", "properties": {}},
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

GET_SKILL_DETAIL_TOOL = Tool(
    id="allhands.meta.get_skill_detail",
    kind=ToolKind.META,
    name="get_skill_detail",
    description="Get a skill's full detail: description, tool_ids, prompt_fragment.",
    input_schema={
        "type": "object",
        "properties": {"skill_id": {"type": "string"}},
        "required": ["skill_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

LIST_SKILL_MARKET_TOOL = Tool(
    id="allhands.meta.list_skill_market",
    kind=ToolKind.META,
    name="list_skill_market",
    description=(
        "List curated skills available for one-click install from the official GitHub "
        "market (default: anthropics/skills). Optional `query` does a substring match "
        "on slug / name / description / tags."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Substring filter; omit for full listing.",
            },
        },
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

PREVIEW_SKILL_MARKET_TOOL = Tool(
    id="allhands.meta.preview_skill_market",
    kind=ToolKind.META,
    name="preview_skill_market",
    description=(
        "Fetch a market skill's SKILL.md + file listing BEFORE installing. "
        "Use this to let the user read the skill's intent / trigger rules / "
        "bundled files before committing to install."
    ),
    input_schema={
        "type": "object",
        "properties": {"slug": {"type": "string"}},
        "required": ["slug"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
)

INSTALL_SKILL_FROM_GITHUB_TOOL = Tool(
    id="allhands.meta.install_skill_from_github",
    kind=ToolKind.META,
    name="install_skill_from_github",
    description=(
        "Install a skill from a GitHub URL. Clones the repo, reads SKILL.md "
        "frontmatter, registers the skill in the DB."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "https://github.com/<org>/<repo>[/tree/<ref>/<path>]",
            },
            "ref": {"type": "string", "default": "main"},
        },
        "required": ["url"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

INSTALL_SKILL_FROM_MARKET_TOOL = Tool(
    id="allhands.meta.install_skill_from_market",
    kind=ToolKind.META,
    name="install_skill_from_market",
    description="Install a curated skill from the market by slug.",
    input_schema={
        "type": "object",
        "properties": {"slug": {"type": "string"}},
        "required": ["slug"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

UPDATE_SKILL_TOOL = Tool(
    id="allhands.meta.update_skill",
    kind=ToolKind.META,
    name="update_skill",
    description="Update an installed skill's description or prompt fragment.",
    input_schema={
        "type": "object",
        "properties": {
            "skill_id": {"type": "string"},
            "description": {"type": "string"},
            "prompt_fragment": {"type": "string"},
        },
        "required": ["skill_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.WRITE,
    requires_confirmation=True,
)

DELETE_SKILL_TOOL = Tool(
    id="allhands.meta.delete_skill",
    kind=ToolKind.META,
    name="delete_skill",
    description="Permanently uninstall a skill — removes DB row + on-disk files.",
    input_schema={
        "type": "object",
        "properties": {"skill_id": {"type": "string"}},
        "required": ["skill_id"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.IRREVERSIBLE,
    requires_confirmation=True,
)


ALL_SKILL_META_TOOLS = [
    LIST_SKILLS_TOOL,
    GET_SKILL_DETAIL_TOOL,
    LIST_SKILL_MARKET_TOOL,
    PREVIEW_SKILL_MARKET_TOOL,
    INSTALL_SKILL_FROM_GITHUB_TOOL,
    INSTALL_SKILL_FROM_MARKET_TOOL,
    UPDATE_SKILL_TOOL,
    DELETE_SKILL_TOOL,
]
