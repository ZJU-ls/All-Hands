"""Parsers — html (stdlib) + docx (optional) + markdown."""

from __future__ import annotations

from pathlib import Path

import pytest

from allhands.execution.knowledge.parsers import detect_mime, get_parser_for
from allhands.execution.knowledge.parsers.docx import DocxParseError, DocxParser


def test_html_parser_extracts_headings_and_drops_script(tmp_path: Path) -> None:
    src = tmp_path / "page.html"
    src.write_text(
        """<!doctype html><html><head><style>body { color: red }</style></head>
<body>
<h1>Top</h1>
<p>intro</p>
<script>alert('nope')</script>
<h2>Section A</h2>
<p>body of A</p>
<h2>Section B</h2>
<p>body of B</p>
</body></html>""",
        encoding="utf-8",
    )
    parser = get_parser_for("text/html")
    assert parser is not None
    parsed = parser.parse(str(src))
    titles = [s.title for s in parsed.sections]
    assert titles == ["Top", "Section A", "Section B"]
    assert "alert(" not in parsed.text
    assert "intro" in parsed.text


def test_detect_mime_for_html_and_docx() -> None:
    assert detect_mime("foo.html") == "text/html"
    assert detect_mime("Doc.HTM") == "text/html"
    assert (
        detect_mime("memo.docx")
        == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )


def test_docx_parser_missing_dep_raises_clean_error(tmp_path: Path) -> None:
    """If python-docx isn't installed, the parser must raise our typed
    error, not a generic ImportError. The orchestrator catches DocxParseError
    and writes a remediation hint into the doc's state_error field."""
    try:
        import docx  # type: ignore[import-not-found]  # noqa: F401

        pytest.skip("python-docx is installed; cannot exercise the missing-dep branch")
    except ImportError:
        pass
    fake = tmp_path / "x.docx"
    fake.write_bytes(b"PK\x03\x04not really a docx")
    with pytest.raises(DocxParseError):
        DocxParser().parse(str(fake))
