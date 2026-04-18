"""Render tool: link_card — rich external link preview."""

from __future__ import annotations

from allhands.core import CostHint, Tool, ToolKind, ToolScope

TOOL = Tool(
    id="allhands.render.link_card",
    kind=ToolKind.RENDER,
    name="render_link_card",
    description=(
        "Render a rich preview of an external URL with title/description/site. "
        "Use when recommending a single external resource. For several links, "
        "use render_cards or render_markdown with a list."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "url": {"type": "string", "format": "uri"},
            "title": {"type": "string"},
            "description": {"type": "string"},
            "favicon": {"type": "string"},
            "site_name": {"type": "string"},
        },
        "required": ["url", "title"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


async def execute(
    url: str,
    title: str,
    description: str | None = None,
    favicon: str | None = None,
    site_name: str | None = None,
) -> dict[str, object]:
    return {
        "component": "Viz.LinkCard",
        "props": {
            "url": url,
            "title": title,
            "description": description,
            "favicon": favicon,
            "siteName": site_name,
        },
        "interactions": [
            {
                "kind": "link",
                "label": "Open",
                "action": "navigate",
                "payload": {"url": url},
            }
        ],
    }
