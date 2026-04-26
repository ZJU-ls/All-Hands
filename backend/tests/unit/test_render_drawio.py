"""Tests for render_drawio tool — single-call drawio diagram.

2026-04-26 · "drop the four-step ritual" refactor. Previously drawio
required: read_skill_file → fill placeholders → artifact_create →
artifact_render. New flow is one tool, one call: persist + render
envelope in a single executor return.
"""

from __future__ import annotations

import pytest

from allhands.core import ToolKind, ToolScope
from allhands.execution.tools.meta.artifact_office import RENDER_DRAWIO_TOOL
from allhands.execution.tools.meta.executors import (
    _normalize_drawio_name,
    _normalize_drawio_xml,
)


def test_render_drawio_tool_schema() -> None:
    assert RENDER_DRAWIO_TOOL.id == "allhands.artifacts.render_drawio"
    assert RENDER_DRAWIO_TOOL.kind == ToolKind.META
    assert RENDER_DRAWIO_TOOL.name == "render_drawio"
    assert RENDER_DRAWIO_TOOL.scope == ToolScope.WRITE
    assert RENDER_DRAWIO_TOOL.requires_confirmation is False
    required = RENDER_DRAWIO_TOOL.input_schema["required"]
    assert "name" in required
    assert "xml" in required


def test_normalize_name_adds_drawio_suffix() -> None:
    assert _normalize_drawio_name("login flow") == "login flow.drawio"
    assert _normalize_drawio_name("login.drawio") == "login.drawio"
    assert _normalize_drawio_name("UPPER.DRAWIO") == "UPPER.DRAWIO"
    assert _normalize_drawio_name("  trimmed  ") == "trimmed.drawio"


def test_normalize_xml_passthrough_when_full_mxfile() -> None:
    body = '<mxfile host="x"><diagram><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>'
    assert _normalize_drawio_xml(body) == body
    assert _normalize_drawio_xml(f"  \n{body}  ") == body


def test_normalize_xml_wraps_bare_mxgraphmodel() -> None:
    inner = '<mxGraphModel><root><mxCell id="0"/></root></mxGraphModel>'
    out = _normalize_drawio_xml(inner)
    assert out.startswith("<mxfile")
    assert inner in out
    assert "<diagram" in out


def test_normalize_xml_wraps_bare_diagram() -> None:
    inner = '<diagram name="x"><mxGraphModel><root/></mxGraphModel></diagram>'
    out = _normalize_drawio_xml(inner)
    assert out.startswith("<mxfile")
    assert out.endswith("</mxfile>")
    assert inner in out


def test_normalize_xml_wraps_bare_mxcell_list() -> None:
    inner = '<mxCell id="n1" value="A"/><mxCell id="n2" value="B"/>'
    out = _normalize_drawio_xml(inner)
    assert out.startswith("<mxfile")
    assert "<mxGraphModel" in out
    assert '<mxCell id="0"/>' in out
    assert '<mxCell id="1" parent="0"/>' in out
    assert inner in out


@pytest.mark.asyncio
async def test_executor_rejects_empty_xml() -> None:
    from allhands.execution.tools.meta.executors import make_render_drawio_executor

    exec_fn = make_render_drawio_executor(maker=None)  # type: ignore[arg-type]
    out = await exec_fn(name="x", xml="")
    assert "error" in out
    assert "empty" in out["error"]

    out2 = await exec_fn(name="x", xml="   \n  ")
    assert "error" in out2
