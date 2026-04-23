"""Render tool: stat — single KPI card with headline value + optional delta."""

from __future__ import annotations

import json
from typing import Any

from allhands.core import CostHint, Tool, ToolKind, ToolScope

TOOL = Tool(
    id="allhands.render.stat",
    kind=ToolKind.RENDER,
    name="render_stat",
    description=(
        "Render a single headline metric (value + label, with optional "
        "unit, delta, and tiny sparkline). Use when the answer is one "
        "number the user should see at a glance (e.g. total runs today, "
        "p95 latency). Use render_kv for 2+ related fields on the same "
        "entity and render_cards for side-by-side metric comparison."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "label": {"type": "string"},
            "value": {"type": ["string", "number"]},
            "unit": {"type": "string"},
            "delta": {
                "anyOf": [
                    {
                        "type": "object",
                        "properties": {
                            "value": {"type": ["string", "number"]},
                            "direction": {
                                "type": "string",
                                "enum": ["up", "down", "flat"],
                            },
                            "trend": {
                                "type": "string",
                                "enum": ["up", "down", "flat"],
                                "description": "Alias for direction; accepted for model compatibility.",
                            },
                            "tone": {
                                "type": "string",
                                "enum": ["positive", "negative", "neutral"],
                                "default": "neutral",
                            },
                        },
                        "required": ["value"],
                    },
                    {
                        "type": "string",
                        "description": (
                            "JSON-encoded delta object. Accepted for compatibility with "
                            "models that stringify nested tool args."
                        ),
                    },
                ],
            },
            "spark": {
                "type": "array",
                "items": {"type": "number"},
                "description": "Optional trailing values for an inline sparkline.",
            },
            "caption": {"type": "string"},
        },
        "required": ["label", "value"],
    },
    output_schema={"type": "object"},
    scope=ToolScope.READ,
    requires_confirmation=False,
    cost_hint=CostHint(relative="low"),
)


async def execute(
    label: str,
    value: Any,
    unit: str | None = None,
    delta: Any = None,
    spark: list[float] | None = None,
    caption: str | None = None,
) -> dict[str, object]:
    delta_obj = _normalize_delta(delta)
    return {
        "component": "Viz.Stat",
        "props": {
            "label": label,
            "value": value,
            "unit": unit,
            "delta": delta_obj,
            "spark": spark,
            "caption": caption,
        },
        "interactions": [],
    }


def _normalize_delta(delta: Any) -> dict[str, Any] | None:
    if delta is None:
        return None
    if isinstance(delta, str):
        try:
            delta = json.loads(delta)
        except (TypeError, ValueError):
            return None
    if not isinstance(delta, dict):
        return None

    value = delta.get("value")
    direction = delta.get("direction")
    if direction is None:
        direction = delta.get("trend")
    if direction not in {"up", "down", "flat"}:
        direction = "flat"

    tone = delta.get("tone")
    if tone not in {"positive", "negative", "neutral"}:
        tone = "neutral"

    if value is None:
        return None

    return {
        "value": value,
        "direction": direction,
        "tone": tone,
    }
