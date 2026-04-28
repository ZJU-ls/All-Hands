"""PDF parser.

Uses ``pypdf`` if available (lightweight pure-python). Heavier OCR for
scanned PDFs lives in a separate `pdf_ocr.py` we'll add in M3 — that one
will pull in paddleocr / pytesseract behind an extras flag.

Each page becomes a Section with the title "Page N" so chunker can keep
chunks within page boundaries when possible (helpful for citation back to
a page number).

If pypdf is missing the parser raises a friendly error so the orchestrator
can mark the doc FAILED with a clear remediation hint, not a stack trace.
"""

from __future__ import annotations

from allhands.execution.knowledge.parsers import ParseResult, Section


class PdfParseError(RuntimeError):
    pass


class PdfParser:
    mime_types: tuple[str, ...] = ("application/pdf",)

    def parse(self, file_path: str) -> ParseResult:
        try:
            from pypdf import PdfReader  # type: ignore[import-not-found]
        except ImportError as exc:  # pragma: no cover
            raise PdfParseError(
                "pypdf is required to ingest PDFs. Install with `uv add pypdf`."
            ) from exc

        reader = PdfReader(file_path)
        page_texts: list[str] = []
        sections: list[Section] = []
        char_cursor = 0
        for i, page in enumerate(reader.pages, start=1):
            try:
                text = page.extract_text() or ""
            except Exception:
                text = ""
            text = text.strip()
            page_texts.append(text)
            if text:
                start = char_cursor
                # +1 for the joiner newline appended below
                end = start + len(text)
                sections.append(
                    Section(
                        title=f"Page {i}",
                        level=1,
                        char_start=start,
                        char_end=end,
                        page=i,
                    )
                )
                char_cursor = end + 2  # accounts for "\n\n" joiner

        text = "\n\n".join(t for t in page_texts if t)
        page_count = len(reader.pages)
        meta_obj = reader.metadata
        meta = {
            "format": "pdf",
            "title": getattr(meta_obj, "title", None) if meta_obj else None,
            "author": getattr(meta_obj, "author", None) if meta_obj else None,
        }
        return ParseResult(text=text, sections=sections, metadata=meta, page_count=page_count)
