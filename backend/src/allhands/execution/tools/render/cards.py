"""Render tool: cards — 3-6 parallel options / proposals."""

from __future__ import annotations

from typing import Any

from allhands.core import CostHint, Tool, ToolKind, ToolScope

TOOL = Tool(
    id="allhands.render.cards",
    kind=ToolKind.RENDER,
    name="render_cards",
    description=(
        "Render 2-6 parallel options as side-by-side cards. Use when comparing "
        "design proposals, plan alternatives, or mutually-exclusive choices. For "
        ">6 items or tabular comparison, use render_table instead."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "cards": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "description": {"type": "string"},
                        "footer": {"type": "string"},
                        "accent": {
                            "type": "string",
                            "enum": ["default", "primary", "success", "warn", "error"],
                        },
                    },
                    "required": ["title", "description"],
                },
            },
            "columns": {"type": "integer", "minimum": 2, "maximum": 4, "default": 3},
        },
        "required": ["cards"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


async def execute(
    cards: list[dict[str, Any]],
    columns: int = 3,
) -> dict[str, object]:
    return {
        "component": "Viz.Cards",
        "props": {"cards": cards, "columns": columns},
        "interactions": [],
    }
