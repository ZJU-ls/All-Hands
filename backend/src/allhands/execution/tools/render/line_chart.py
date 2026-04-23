"""Render tool: line_chart — time-series / trend lines in pure SVG.

Use when the user needs to see how one or more numeric series evolve along
an ordered x-axis (time, steps, index). For side-by-side categorical
comparisons prefer ``render_bar_chart``; for proportions of a whole prefer
``render_pie_chart``.
"""

from __future__ import annotations

from typing import Any

from allhands.core import CostHint, Tool, ToolKind, ToolScope

TOOL = Tool(
    id="allhands.render.line_chart",
    kind=ToolKind.RENDER,
    name="render_line_chart",
    description=(
        "Render one or more numeric series as a line chart over an ordered "
        "x-axis. Use for trends over time or sequence (latency over hour, "
        "token count per turn). Not for categorical comparison — use "
        "render_bar_chart for that. Keep series count ≤ 4 for readability."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "x": {
                "type": "array",
                "items": {"type": ["string", "number"]},
                "description": "Ordered x-axis labels (timestamps, step names, indices).",
            },
            "series": {
                "type": "array",
                "minItems": 1,
                "maxItems": 4,
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "values": {
                            "type": "array",
                            "items": {"type": "number"},
                            "description": "Same length as `x`.",
                        },
                    },
                    "required": ["label", "values"],
                },
            },
            "y_label": {"type": "string"},
            "caption": {"type": "string"},
        },
        "required": ["x", "series"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


async def execute(
    x: list[Any],
    series: list[dict[str, Any]],
    y_label: str | None = None,
    caption: str | None = None,
) -> dict[str, object]:
    return {
        "component": "Viz.LineChart",
        "props": {
            "x": x,
            "series": series,
            "y_label": y_label,
            "caption": caption,
        },
        "interactions": [],
    }
