"""Plain-text parser. UTF-8 strict; replacement chars allowed for binary surprises."""

from __future__ import annotations

from pathlib import Path

from allhands.execution.knowledge.parsers import ParseResult


class TextParser:
    mime_types: tuple[str, ...] = ("text/plain",)

    def parse(self, file_path: str) -> ParseResult:
        text = Path(file_path).read_text(encoding="utf-8", errors="replace")
        return ParseResult(text=text, sections=[], metadata={"format": "text"})
