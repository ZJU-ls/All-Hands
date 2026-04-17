"""Render tool: markdown_card — render markdown content inline in chat."""

from __future__ import annotations

from allhands.core import CostHint, Tool, ToolKind, ToolScope

TOOL = Tool(
    id="allhands.render.markdown_card",
    kind=ToolKind.RENDER,
    name="render_markdown",
    description="Render markdown content inline in the chat interface.",
    input_schema={
        "type": "object",
        "properties": {
            "content": {"type": "string", "description": "Markdown content to render."},
            "title": {"type": "string", "description": "Optional title for the card."},
        },
        "required": ["content"],
    },
    output_schema={
        "type": "object",
        "properties": {
            "component": {"type": "string"},
            "props": {"type": "object"},
        },
    },
    scope=ToolScope.READ,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


async def execute(content: str, title: str = "") -> dict[str, object]:
    return {
        "component": "MarkdownCard",
        "props": {"content": content, "title": title},
        "interactions": [
            {
                "kind": "button",
                "label": "Copy",
                "action": "copy_to_clipboard",
                "payload": {"text": content},
            }
        ],
    }
