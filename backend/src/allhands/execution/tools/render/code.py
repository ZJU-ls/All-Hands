"""Render tool: code — syntax-highlighted code block."""

from __future__ import annotations

from allhands.core import CostHint, Tool, ToolKind, ToolScope

TOOL = Tool(
    id="allhands.render.code",
    kind=ToolKind.RENDER,
    name="render_code",
    description=(
        "Render a code snippet with syntax highlighting. Always prefer this "
        "over embedding raw code in markdown — users get copy buttons and "
        "language-aware coloring. For showing changes between two versions, "
        "use render_diff instead."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "code": {"type": "string"},
            "language": {
                "type": "string",
                "description": "Language identifier (python, typescript, bash, json, ...).",
            },
            "filename": {"type": "string"},
            "highlight_lines": {
                "type": "array",
                "items": {"type": "integer"},
                "description": "Optional 1-indexed line numbers to highlight.",
            },
        },
        "required": ["code", "language"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


async def execute(
    code: str,
    language: str,
    filename: str | None = None,
    highlight_lines: list[int] | None = None,
) -> dict[str, object]:
    return {
        "component": "Viz.Code",
        "props": {
            "code": code,
            "language": language,
            "filename": filename,
            "highlightLines": highlight_lines or [],
        },
        "interactions": [
            {
                "kind": "button",
                "label": "Copy",
                "action": "copy_to_clipboard",
                "payload": {"text": code},
            }
        ],
    }
