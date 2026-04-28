"""Unit tests for attachment_extractor."""

from __future__ import annotations

from pathlib import Path

import pytest

from allhands.services.attachment_extractor import extract_text


def test_extract_plain_text(tmp_path: Path) -> None:
    p = tmp_path / "a.txt"
    p.write_text("hello world\nline 2\n")
    out = extract_text(p, "text/plain")
    assert out == "hello world\nline 2\n"


def test_extract_json(tmp_path: Path) -> None:
    p = tmp_path / "a.json"
    p.write_text('{"a":1}')
    out = extract_text(p, "application/json")
    assert out is not None
    assert "a" in out


def test_extract_truncates_large_text(tmp_path: Path) -> None:
    p = tmp_path / "big.txt"
    p.write_text("x" * 200_000)
    out = extract_text(p, "text/plain")
    assert out is not None
    assert "…truncated" in out
    assert len(out.encode("utf-8")) <= 200_000  # capped


def test_extract_unsupported_returns_none(tmp_path: Path) -> None:
    p = tmp_path / "a.bin"
    p.write_bytes(b"\x00\x01\x02")
    out = extract_text(p, "application/x-msdownload")
    assert out is None


def test_extract_docx(tmp_path: Path) -> None:
    docx = pytest.importorskip("docx")
    p = tmp_path / "a.docx"
    doc = docx.Document()
    doc.add_paragraph("hello docx")
    doc.add_paragraph("second line")
    doc.save(str(p))
    out = extract_text(
        p,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    assert out is not None
    assert "hello docx" in out
    assert "second line" in out


def test_extract_xlsx(tmp_path: Path) -> None:
    openpyxl = pytest.importorskip("openpyxl")
    p = tmp_path / "a.xlsx"
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["name", "age"])
    ws.append(["Alice", 30])
    ws.append(["Bob", 42])
    wb.save(str(p))
    out = extract_text(
        p,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    assert out is not None
    assert "Alice" in out
    assert "30" in out


def test_extract_pdf(tmp_path: Path) -> None:
    """Build a minimal PDF with reportlab if available; else skip."""
    reportlab = pytest.importorskip("reportlab.pdfgen.canvas")
    p = tmp_path / "a.pdf"
    c = reportlab.Canvas(str(p))
    c.drawString(100, 750, "hello pdf body")
    c.showPage()
    c.save()
    out = extract_text(p, "application/pdf")
    assert out is not None
    assert "hello pdf" in out
