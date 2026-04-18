"""Render tool: table — structured rows as a sortable table.

Use when you need to compare multiple items by multiple attributes. For a
single entity's properties, prefer `allhands.render.kv`. For 3-6 side-by-side
options, prefer `allhands.render.cards`.
"""

from __future__ import annotations

from typing import Any

from allhands.core import CostHint, Tool, ToolKind, ToolScope

TOOL = Tool(
    id="allhands.render.table",
    kind=ToolKind.RENDER,
    name="render_table",
    description=(
        "Render structured rows into a sortable table. Use when comparing multiple "
        "items across multiple attributes (e.g. 3 employees by 5 metrics). Do NOT "
        "use for a single object (use render_kv) or for free-form text (use "
        "render_markdown)."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "columns": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string"},
                        "label": {"type": "string"},
                        "align": {"type": "string", "enum": ["left", "right", "center"]},
                        "width": {"type": "string"},
                    },
                    "required": ["key", "label"],
                },
                "description": "Column definitions. `key` matches row dict keys.",
            },
            "rows": {
                "type": "array",
                "items": {"type": "object"},
                "description": "Array of row objects keyed by column.key.",
            },
            "caption": {"type": "string", "description": "Optional caption below the table."},
        },
        "required": ["columns", "rows"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


async def execute(
    columns: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    caption: str | None = None,
) -> dict[str, object]:
    return {
        "component": "Viz.Table",
        "props": {"columns": columns, "rows": rows, "caption": caption},
        "interactions": [],
    }
