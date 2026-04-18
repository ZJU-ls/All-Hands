"""Render tool: timeline — chronological events or plan history."""

from __future__ import annotations

from typing import Any

from allhands.core import CostHint, Tool, ToolKind, ToolScope

TOOL = Tool(
    id="allhands.render.timeline",
    kind=ToolKind.RENDER,
    name="render_timeline",
    description=(
        "Render a chronological sequence (events, history, planned checkpoints). "
        "Use when order matters and items have time/status. For a fixed-length "
        "wizard-style flow, use render_steps instead."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "status": {
                            "type": "string",
                            "enum": ["pending", "in_progress", "done", "failed"],
                        },
                        "note": {"type": "string"},
                        "time": {"type": "string"},
                    },
                    "required": ["title", "status"],
                },
            },
            "layout": {
                "type": "string",
                "enum": ["horizontal", "vertical"],
                "default": "vertical",
            },
        },
        "required": ["items"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


async def execute(
    items: list[dict[str, Any]],
    layout: str = "vertical",
) -> dict[str, object]:
    return {
        "component": "Viz.Timeline",
        "props": {"items": items, "layout": layout},
        "interactions": [],
    }
