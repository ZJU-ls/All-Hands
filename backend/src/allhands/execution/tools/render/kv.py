"""Render tool: kv — key/value card for a single entity's properties."""

from __future__ import annotations

from typing import Any

from allhands.core import CostHint, Tool, ToolKind, ToolScope

TOOL = Tool(
    id="allhands.render.kv",
    kind=ToolKind.RENDER,
    name="render_kv",
    description=(
        "Render a single entity's properties as a label/value card. Use when "
        "showing the details of ONE object (e.g. one employee's config, one "
        "run's metadata). For multiple objects, use render_table instead."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string"},
                        "value": {"type": "string"},
                        "hint": {"type": "string"},
                    },
                    "required": ["label", "value"],
                },
            },
            "title": {"type": "string"},
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
    title: str | None = None,
) -> dict[str, object]:
    return {
        "component": "Viz.KV",
        "props": {"items": items, "title": title},
        "interactions": [],
    }
