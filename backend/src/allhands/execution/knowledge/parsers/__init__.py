"""Parser registry — mime_type → Parser.

Adding a new format:

  from allhands.execution.knowledge.parsers import register_parser
  register_parser(MyHtmlParser())

Parsers must be deterministic and side-effect-free. They take a file path
and return a `ParseResult` (text + sections + metadata). Heavy or optional
deps (paddleocr, faster-whisper) live in dedicated modules whose import
is wrapped in try/except so the core package doesn't choke when extras
aren't installed.
"""

from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel, Field


class Section(BaseModel):
    """A logical block in the parsed document — used for heading-aware chunking.

    `level` mirrors HTML hN: 1 = top-level heading, 6 = deepest. The
    chunker walks sections in order and decides where to split.
    """

    title: str
    level: int = Field(..., ge=1, le=6)
    char_start: int = Field(..., ge=0)
    char_end: int = Field(..., ge=0)
    page: int | None = None

    model_config = {"frozen": True}


class ParseResult(BaseModel):
    text: str
    sections: list[Section] = Field(default_factory=list)
    metadata: dict[str, object] = Field(default_factory=dict)
    page_count: int | None = None

    model_config = {"frozen": True}


class Parser(Protocol):
    """Synchronous parsing interface; orchestrator runs it off-thread if heavy."""

    mime_types: tuple[str, ...]

    def parse(self, file_path: str) -> ParseResult: ...


_REGISTRY: dict[str, Parser] = {}


def register_parser(parser: Parser) -> None:
    for mt in parser.mime_types:
        _REGISTRY[mt.lower()] = parser


def get_parser_for(mime_type: str) -> Parser | None:
    return _REGISTRY.get(mime_type.lower())


def detect_mime(filename: str) -> str:
    """Best-effort mime detection from the filename suffix.

    Falls back to text/plain for unknown extensions; the parser registry
    will then return None and the orchestrator marks the doc FAILED with
    a clear "no parser" error.
    """
    import mimetypes

    name = filename.lower()
    # Common KB formats not in stdlib mimetypes by default
    overrides = {
        ".md": "text/markdown",
        ".markdown": "text/markdown",
        ".mdx": "text/markdown",
        ".pdf": "application/pdf",
        ".txt": "text/plain",
        ".html": "text/html",
        ".htm": "text/html",
        ".json": "application/json",
        ".csv": "text/csv",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".epub": "application/epub+zip",
    }
    for ext, mime in overrides.items():
        if name.endswith(ext):
            return mime
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or "text/plain"


# ── built-in parsers (eager registration on import)
from allhands.execution.knowledge.parsers.docx import DocxParser  # noqa: E402
from allhands.execution.knowledge.parsers.html import HtmlParser  # noqa: E402
from allhands.execution.knowledge.parsers.markdown import MarkdownParser  # noqa: E402
from allhands.execution.knowledge.parsers.pdf import PdfParser  # noqa: E402
from allhands.execution.knowledge.parsers.text import TextParser  # noqa: E402

register_parser(MarkdownParser())
register_parser(TextParser())
register_parser(PdfParser())
register_parser(HtmlParser())
register_parser(DocxParser())


__all__ = [
    "ParseResult",
    "Parser",
    "Section",
    "detect_mime",
    "get_parser_for",
    "register_parser",
]
