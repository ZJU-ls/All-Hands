"""Render tool: diff — before/after comparison."""

from __future__ import annotations

from allhands.core import CostHint, Tool, ToolKind, ToolScope

TOOL = Tool(
    id="allhands.render.diff",
    kind=ToolKind.RENDER,
    name="render_diff",
    description=(
        "Render a before/after diff. Use when summarizing a change to code or "
        "text so the user sees exactly what shifted. For a single version of "
        "code, use render_code instead."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "before": {"type": "string"},
            "after": {"type": "string"},
            "language": {"type": "string"},
            "mode": {
                "type": "string",
                "enum": ["unified", "split"],
                "default": "unified",
            },
            "filename": {"type": "string"},
        },
        "required": ["before", "after"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


async def execute(
    before: str,
    after: str,
    language: str | None = None,
    mode: str = "unified",
    filename: str | None = None,
) -> dict[str, object]:
    return {
        "component": "Viz.Diff",
        "props": {
            "before": before,
            "after": after,
            "language": language,
            "mode": mode,
            "filename": filename,
        },
        "interactions": [],
    }
