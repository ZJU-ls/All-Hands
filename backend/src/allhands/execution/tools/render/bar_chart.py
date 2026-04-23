"""Render tool: bar_chart — categorical comparison in pure SVG."""

from __future__ import annotations

from typing import Any

from allhands.core import CostHint, Tool, ToolKind, ToolScope

TOOL = Tool(
    id="allhands.render.bar_chart",
    kind=ToolKind.RENDER,
    name="render_bar_chart",
    description=(
        "Render a vertical or horizontal bar chart to compare numeric values "
        "across discrete categories (e.g. cost per provider, runs per "
        "employee). Use render_line_chart for ordered trends and "
        "render_pie_chart for proportions of a whole."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "bars": {
                "type": "array",
                "minItems": 1,
                "maxItems": 20,
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "value": {"type": "number"},
                    },
                    "required": ["label", "value"],
                },
            },
            "orientation": {
                "type": "string",
                "enum": ["vertical", "horizontal"],
                "default": "vertical",
            },
            "value_label": {"type": "string"},
            "caption": {"type": "string"},
        },
        "required": ["bars"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


async def execute(
    bars: list[dict[str, Any]],
    orientation: str = "vertical",
    value_label: str | None = None,
    caption: str | None = None,
) -> dict[str, object]:
    return {
        "component": "Viz.BarChart",
        "props": {
            "bars": bars,
            "orientation": orientation,
            "value_label": value_label,
            "caption": caption,
        },
        "interactions": [],
    }
