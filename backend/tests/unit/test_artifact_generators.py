"""Smoke tests for the 5 office artifact generators.

These exercise the happy path + a couple of failure shapes so the executor
layer doesn't have to re-test the same things in integration.
"""

from __future__ import annotations

import io
import zipfile

import pytest

from allhands.execution.artifact_generators.csv import render_csv
from allhands.execution.artifact_generators.docx import render_docx
from allhands.execution.artifact_generators.pdf import (
    ArtifactGenerationError,
    render_pdf,
)
from allhands.execution.artifact_generators.pptx import extract_slide_text, render_pptx
from allhands.execution.artifact_generators.xlsx import render_xlsx


def _weasyprint_available() -> bool:
    """weasyprint loads cairo/pango at import time. On dev macs without
    homebrew pango / on minimal CI containers it raises OSError. Skip the
    PDF tests there — the production docker image installs the libs."""
    try:
        import weasyprint  # noqa: F401

        return True
    except (ImportError, OSError):
        return False


_skip_no_weasyprint = pytest.mark.skipif(
    not _weasyprint_available(),
    reason="weasyprint requires cairo/pango at runtime; install via apt or brew",
)


# ----------------------------------------------------------------------
# pdf
# ----------------------------------------------------------------------


@_skip_no_weasyprint
def test_pdf_from_markdown_returns_pdf_signature() -> None:
    blob = render_pdf(source="markdown", content="# 测试\n\n你好,世界。")
    assert blob[:4] == b"%PDF"
    assert len(blob) > 200


def test_pdf_empty_content_raises() -> None:
    with pytest.raises(ArtifactGenerationError):
        render_pdf(source="markdown", content="")


@_skip_no_weasyprint
def test_pdf_from_html_with_full_doc_passes_through() -> None:
    html = "<!doctype html><html><body><h1>title</h1></body></html>"
    blob = render_pdf(source="html", content=html)
    assert blob[:4] == b"%PDF"


# ----------------------------------------------------------------------
# xlsx
# ----------------------------------------------------------------------


def test_xlsx_basic_two_sheets() -> None:
    blob = render_xlsx(
        sheets=[
            {"name": "A", "headers": ["x", "y"], "rows": [[1, 2], [3, 4]]},
            {"name": "B", "rows": [["foo", "bar"]]},
        ]
    )
    # xlsx files are zip-formatted under the hood.
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        names = set(zf.namelist())
        assert "xl/workbook.xml" in names
        assert any(n.startswith("xl/worksheets/") for n in names)


def test_xlsx_formula_string_is_escaped() -> None:
    """Confirms a leading-= cell is round-trippable as text — not evaluated.

    openpyxl writes inline strings into the worksheet xml directly (not
    sharedStrings) so we read sheet1 and check the raw xml for the literal.
    """
    blob = render_xlsx(sheets=[{"name": "A", "rows": [["=SUM(A1:A2)"]]}])
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        sheet_xml = zf.read("xl/worksheets/sheet1.xml").decode()
        ss_xml = ""
        if "xl/sharedStrings.xml" in zf.namelist():
            ss_xml = zf.read("xl/sharedStrings.xml").decode()
        assert "=SUM" in (sheet_xml + ss_xml)


def test_xlsx_empty_sheet_list_raises() -> None:
    with pytest.raises(ArtifactGenerationError):
        render_xlsx(sheets=[])


# ----------------------------------------------------------------------
# csv
# ----------------------------------------------------------------------


def test_csv_with_bom_and_quoting() -> None:
    blob = render_csv(headers=["a", "b"], rows=[["1", "two,with,commas"]])
    text = blob.decode("utf-8-sig")
    assert text.startswith("a,b\r\n")
    assert '"two,with,commas"' in text


def test_csv_handles_none() -> None:
    blob = render_csv(headers=None, rows=[[1, None, "x"]])
    assert b"1,," in blob


# ----------------------------------------------------------------------
# docx
# ----------------------------------------------------------------------


def test_docx_renders_heading_paragraph_list_table() -> None:
    blob, warnings = render_docx(
        blocks=[
            {"type": "heading", "level": 1, "text": "Title"},
            {"type": "paragraph", "text": "lorem"},
            {"type": "list", "ordered": False, "items": ["a", "b"]},
            {
                "type": "table",
                "headers": ["k", "v"],
                "rows": [["x", "1"], ["y", "2"]],
            },
        ]
    )
    assert warnings == []
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        body = zf.read("word/document.xml").decode()
        assert "Title" in body
        assert "lorem" in body


def test_docx_unknown_block_collected_as_warning() -> None:
    _, warnings = render_docx(blocks=[{"type": "weird", "text": "x"}])
    assert len(warnings) == 1
    assert "weird" in warnings[0]


# ----------------------------------------------------------------------
# pptx
# ----------------------------------------------------------------------


def test_pptx_renders_title_and_bullets() -> None:
    blob, warnings = render_pptx(
        slides=[
            {"layout": "title", "title": "Cover", "subtitle": "Q1"},
            {"layout": "bullets", "title": "Agenda", "bullets": ["one", "two"]},
        ]
    )
    assert warnings == []
    outline = extract_slide_text(blob)
    assert len(outline) == 2
    assert outline[0]["title"] == "Cover"
    assert "one" in outline[1]["body"]


def test_pptx_image_url_yields_warning() -> None:
    _, warnings = render_pptx(
        slides=[{"layout": "image-right", "title": "T", "image_url": "https://x"}]
    )
    assert any("image_url" in w for w in warnings)


def test_pptx_empty_raises() -> None:
    with pytest.raises(ArtifactGenerationError):
        render_pptx(slides=[])
