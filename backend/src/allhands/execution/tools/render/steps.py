"""Render tool: steps — wizard or fixed-order step sequence."""

from __future__ import annotations

from typing import Any

from allhands.core import CostHint, Tool, ToolKind, ToolScope

TOOL = Tool(
    id="allhands.render.steps",
    kind=ToolKind.RENDER,
    name="render_steps",
    description=(
        "Render a fixed-length step sequence (wizard / onboarding / setup). "
        "Use when the user has a small, well-defined ordered flow. For "
        "open-ended chronological events, use render_timeline instead."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "description": {"type": "string"},
                        "status": {
                            "type": "string",
                            "enum": ["pending", "in_progress", "done", "failed"],
                        },
                    },
                    "required": ["title", "status"],
                },
            },
            "current": {"type": "integer", "minimum": 0},
        },
        "required": ["steps"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


async def execute(
    steps: list[dict[str, Any]],
    current: int | None = None,
) -> dict[str, object]:
    return {
        "component": "Viz.Steps",
        "props": {"steps": steps, "current": current},
        "interactions": [],
    }
