"""Render tool: pie_chart — proportion-of-whole breakdown in pure SVG.

Use only when the slices add up to a meaningful whole and the count is
small (≤ 6). For ranked comparisons prefer ``render_bar_chart``.
"""

from __future__ import annotations

from typing import Any

from allhands.core import CostHint, Tool, ToolKind, ToolScope

TOOL = Tool(
    id="allhands.render.pie_chart",
    kind=ToolKind.RENDER,
    name="render_pie_chart",
    description=(
        "Render a pie/donut chart to show how a whole is split into parts "
        "(e.g. token spend by provider, success / failure breakdown). Keep "
        "slices ≤ 6 — beyond that bars are easier to read. Use "
        "render_bar_chart for ranked comparisons and render_stat for a "
        "single headline number."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "slices": {
                "type": "array",
                "minItems": 2,
                "maxItems": 6,
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "value": {"type": "number", "minimum": 0},
                    },
                    "required": ["label", "value"],
                },
            },
            "variant": {
                "type": "string",
                "enum": ["pie", "donut"],
                "default": "donut",
            },
            "caption": {"type": "string"},
        },
        "required": ["slices"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


async def execute(
    slices: list[dict[str, Any]],
    variant: str = "donut",
    caption: str | None = None,
) -> dict[str, object]:
    return {
        "component": "Viz.PieChart",
        "props": {
            "slices": slices,
            "variant": variant,
            "caption": caption,
        },
        "interactions": [],
    }
