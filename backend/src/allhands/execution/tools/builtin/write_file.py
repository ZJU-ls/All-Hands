"""Backend tool: write_file — write content to the data/reports directory."""

from __future__ import annotations

from pathlib import Path

from allhands.core import CostHint, Tool, ToolKind, ToolScope

TOOL = Tool(
    id="allhands.builtin.write_file",
    kind=ToolKind.BACKEND,
    name="write_file",
    description=("Write text content to a file. Path is relative to the data/reports directory."),
    input_schema={
        "type": "object",
        "properties": {
            "filename": {"type": "string", "description": "Filename, e.g. 'report.md'."},
            "content": {"type": "string", "description": "File content."},
        },
        "required": ["filename", "content"],
    },
    output_schema={
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "bytes_written": {"type": "integer"},
        },
    },
    scope=ToolScope.WRITE,
    requires_confirmation=True,
    cost_hint=CostHint(relative="low"),
)

_REPORTS_DIR = Path("data/reports")


async def execute(filename: str, content: str) -> dict[str, object]:
    _REPORTS_DIR.mkdir(parents=True, exist_ok=True)  # noqa: ASYNC240
    safe_name = Path(filename).name
    path = _REPORTS_DIR / safe_name
    path.write_text(content, encoding="utf-8")
    return {"path": str(path), "bytes_written": len(content.encode())}
