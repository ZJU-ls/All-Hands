"""Render tool: callout — visual highlight for info/warn/success/error."""

from __future__ import annotations

from allhands.core import CostHint, Tool, ToolKind, ToolScope

TOOL = Tool(
    id="allhands.render.callout",
    kind=ToolKind.RENDER,
    name="render_callout",
    description=(
        "Render a highlighted callout box to draw attention to an important "
        "note, warning, success confirmation, or error. Keep content concise — "
        "for long-form content, use render_markdown and set the tone with the "
        "leading sentence instead."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "kind": {
                "type": "string",
                "enum": ["info", "warn", "success", "error"],
            },
            "title": {"type": "string"},
            "content": {"type": "string"},
        },
        "required": ["kind", "content"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


async def execute(
    kind: str,
    content: str,
    title: str | None = None,
) -> dict[str, object]:
    return {
        "component": "Viz.Callout",
        "props": {"kind": kind, "title": title, "content": content},
        "interactions": [],
    }
