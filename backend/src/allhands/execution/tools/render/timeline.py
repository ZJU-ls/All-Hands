"""Render tool: timeline — chronological events or plan history."""

from __future__ import annotations

from typing import Any

from allhands.core import CostHint, Tool, ToolKind, ToolScope

TOOL = Tool(
    id="allhands.render.timeline",
    kind=ToolKind.RENDER,
    name="render_timeline",
    description=(
        "Render a chronological sequence (events, history, planned checkpoints). "
        "Use when order matters and items have time/status. For a fixed-length "
        "wizard-style flow, use render_steps instead. "
        "Each item REQUIRES a non-empty `title` (the headline for that row); "
        "`time` and `note` are optional secondary text."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "status": {
                            "type": "string",
                            "enum": ["pending", "in_progress", "done", "failed"],
                        },
                        "note": {"type": "string"},
                        "time": {"type": "string"},
                    },
                    "required": ["title", "status"],
                },
            },
            "layout": {
                "type": "string",
                "enum": ["horizontal", "vertical"],
                "default": "vertical",
            },
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
    layout: str = "vertical",
) -> dict[str, object]:
    # Schema declares `title` required on each item, but `list[dict[str, Any]]`
    # at runtime sidesteps inner-item Pydantic validation, so models slip
    # through with `{time, status}`-only items and the UI renders empty
    # rounded boxes. Be forgiving + helpful: promote `note` → `title` when
    # title is empty, or fall back to `time` so something readable shows up
    # instead of a blank chip. If even those are missing, surface "(no title)"
    # so the user sees the gap instead of a ghost row.
    # Re-type the input as list[Any] for runtime defense against tools that
    # hand us non-dict items despite the type signature — the upstream
    # `items: list[dict]` is a permissive façade and LLMs do return
    # `[null, ...]` at runtime when they get the schema wrong.
    raw_items: list[Any] = list(items)
    normalized: list[dict[str, Any]] = []
    for it in raw_items:
        if not isinstance(it, dict):
            continue
        title = it.get("title")
        if not isinstance(title, str) or not title.strip():
            note = it.get("note")
            time_val = it.get("time")
            if isinstance(note, str) and note.strip():
                title = note.strip()
                # Don't double-print note as both title and note line.
                it = {**it, "note": None}
            elif isinstance(time_val, str) and time_val.strip():
                title = time_val.strip()
            else:
                title = "(no title)"
        normalized.append({**it, "title": title})
    return {
        "component": "Viz.Timeline",
        "props": {"items": normalized, "layout": layout},
        "interactions": [],
    }
