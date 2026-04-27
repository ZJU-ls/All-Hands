"""End-to-end pptx tool validation · ADR 0021 envelope on the wire.

These tests pin the *contract the LLM sees* when its `artifact_create_pptx`
arguments are wrong. The structured envelope (field/expected/received/
hint) reaches the model via the tool pipeline so it can self-correct on
the next turn instead of guessing.

Specifically:
- stringified-JSON `slides` is recovered by the lenient coerce path
  (matching xlsx behaviour) so a sloppy model still succeeds.
- per-shape primitive errors (type / color / coordinates / chart shape)
  surface with the exact field path the LLM needs to patch.
- library-level failures (unknown layout in old payloads, etc.) come
  back as plain `{error: str}` and never produce the envelope.
"""

from __future__ import annotations

from typing import Any

import pytest

from allhands.core.conversation import ToolUseBlock
from allhands.execution.tool_pipeline import (
    ToolBinding,
    execute_tool_use_concurrent,
)
from allhands.execution.tools.meta.artifact_office import ARTIFACT_CREATE_PPTX_TOOL


async def _persist_stub(**_: Any) -> dict[str, Any]:
    """Stand-in for `_persist_office_artifact` used by the real executor.
    Returns a fake artifact result so we don't need a DB session."""
    return {"artifact_id": "fake-id", "version": 1, "kind": "pptx"}


def _make_executor() -> Any:
    """Build a thin executor that exercises the real renderer + ToolArgError
    propagation path, but bypasses persistence (which needs an async session
    maker we don't want to spin up for a unit test)."""
    from allhands.execution.artifact_generators.pdf import ArtifactGenerationError
    from allhands.execution.artifact_generators.pptx import render_pptx

    async def _exec(
        name: str,
        page: dict[str, Any] | None = None,
        slides: list[dict[str, Any]] | None = None,
        **_: Any,
    ) -> dict[str, Any]:
        try:
            blob, _w = render_pptx(page=page, slides=slides or [])
        except ArtifactGenerationError as exc:
            return {"error": str(exc)}
        return {
            "component": "Artifact.Card",
            "props": {"artifact_id": "fake-id", "version": 1, "kind": "pptx"},
            "interactions": [],
            "artifact_id": "fake-id",
            "version": 1,
            "kind": "pptx",
            "_blob_size": len(blob),
        }

    return _exec


def _bindings() -> dict[str, ToolBinding]:
    return {
        ARTIFACT_CREATE_PPTX_TOOL.name: ToolBinding(
            tool=ARTIFACT_CREATE_PPTX_TOOL,
            executor=_make_executor(),
        )
    }


# ---- happy paths ----------------------------------------------------------


@pytest.mark.asyncio
async def test_valid_minimal_deck_passes_validation_and_renders() -> None:
    block = ToolUseBlock(
        id="tu-1",
        name="artifact_create_pptx",
        input={
            "name": "ok.pptx",
            "slides": [
                {
                    "shapes": [
                        {
                            "type": "text",
                            "x": 1,
                            "y": 1,
                            "w": 6,
                            "h": 1,
                            "text": "Hello",
                        }
                    ]
                }
            ],
        },
    )
    msg = await execute_tool_use_concurrent(block, _bindings())
    assert isinstance(msg.content, dict)
    assert "error" not in msg.content
    assert msg.content["component"] == "Artifact.Card"


@pytest.mark.asyncio
async def test_stringified_slides_array_is_silently_coerced() -> None:
    """Mirrors the xlsx case: the LLM passes `slides` as a JSON-encoded
    string. lenient_coerce in the pipeline parses it before the
    schema-driven validator runs."""
    block = ToolUseBlock(
        id="tu-2",
        name="artifact_create_pptx",
        input={
            "name": "stringy.pptx",
            "slides": ('[{"shapes":[{"type":"text","x":1,"y":1,"w":4,"h":1,"text":"coerced"}]}]'),
        },
    )
    msg = await execute_tool_use_concurrent(block, _bindings())
    assert isinstance(msg.content, dict)
    assert "error" not in msg.content


# ---- ADR 0021 envelopes for primitive errors ------------------------------


@pytest.mark.asyncio
async def test_missing_shape_type_yields_field_path() -> None:
    block = ToolUseBlock(
        id="tu-3",
        name="artifact_create_pptx",
        input={
            "name": "x.pptx",
            "slides": [{"shapes": [{"x": 1, "y": 1, "w": 1, "h": 1}]}],
        },
    )
    msg = await execute_tool_use_concurrent(block, _bindings())
    assert isinstance(msg.content, dict)
    assert msg.content["error"] == "tool input validation failed"
    assert msg.content["field"] == "slides[0].shapes[0].type"


@pytest.mark.asyncio
async def test_chart_missing_categories_yields_envelope() -> None:
    block = ToolUseBlock(
        id="tu-4",
        name="artifact_create_pptx",
        input={
            "name": "x.pptx",
            "slides": [
                {
                    "shapes": [
                        {
                            "type": "chart",
                            "x": 1,
                            "y": 1,
                            "w": 8,
                            "h": 4,
                            "chart_type": "bar",
                            "series": [{"name": "s", "values": [1]}],
                        }
                    ]
                }
            ],
        },
    )
    msg = await execute_tool_use_concurrent(block, _bindings())
    assert isinstance(msg.content, dict)
    assert msg.content["error"] == "tool input validation failed"
    assert msg.content["field"] == "slides[0].shapes[0].categories"
    assert "non-empty array" in msg.content["expected"]


@pytest.mark.asyncio
async def test_color_hex_format_error_yields_envelope_with_hint() -> None:
    block = ToolUseBlock(
        id="tu-5",
        name="artifact_create_pptx",
        input={
            "name": "x.pptx",
            "slides": [
                {
                    "shapes": [
                        {
                            "type": "rect",
                            "x": 1,
                            "y": 1,
                            "w": 2,
                            "h": 1,
                            "fill_hex": "blue",
                        }
                    ]
                }
            ],
        },
    )
    msg = await execute_tool_use_concurrent(block, _bindings())
    assert isinstance(msg.content, dict)
    assert msg.content["error"] == "tool input validation failed"
    assert msg.content["field"] == "slides[0].shapes[0].fill_hex"
    # the hint must contain a concrete example so the model can copy it
    assert "#" in msg.content["hint"]


@pytest.mark.asyncio
async def test_offcanvas_coordinates_yield_envelope() -> None:
    block = ToolUseBlock(
        id="tu-6",
        name="artifact_create_pptx",
        input={
            "name": "x.pptx",
            "slides": [
                {
                    "shapes": [
                        {
                            "type": "rect",
                            "x": 12,
                            "y": 1,
                            "w": 5,
                            "h": 1,
                            "fill_hex": "#000000",
                        }
                    ]
                }
            ],
        },
    )
    msg = await execute_tool_use_concurrent(block, _bindings())
    assert isinstance(msg.content, dict)
    assert msg.content["error"] == "tool input validation failed"
    assert msg.content["field"] == "slides[0].shapes[0].x+w"


@pytest.mark.asyncio
async def test_empty_slides_returns_library_error_not_envelope() -> None:
    """The library-level guard (no slides at all) deliberately fires
    via ArtifactGenerationError, not ToolArgError, because the tool
    schema enforces minItems=1 anyway. This test pins that distinction
    so future refactors don't accidentally route both paths the same way."""
    block = ToolUseBlock(
        id="tu-7",
        name="artifact_create_pptx",
        input={"name": "x.pptx", "slides": []},
    )
    msg = await execute_tool_use_concurrent(block, _bindings())
    assert isinstance(msg.content, dict)
    # plain {error: str}, no `field` key
    assert "error" in msg.content
    assert "field" not in msg.content
