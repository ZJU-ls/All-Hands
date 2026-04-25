"""Markdown parser — preserves heading structure for chunker.

Walks the source linearly, captures `#`..`######` headings into Sections
with char offsets so chunker can split along heading boundaries while
keeping the inline body addressable via span_start/span_end.
"""

from __future__ import annotations

import re
from pathlib import Path

from allhands.execution.knowledge.parsers import ParseResult, Section

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.MULTILINE)


class MarkdownParser:
    mime_types: tuple[str, ...] = ("text/markdown", "text/x-markdown")

    def parse(self, file_path: str) -> ParseResult:
        text = Path(file_path).read_text(encoding="utf-8", errors="replace")
        sections: list[Section] = []
        matches = list(_HEADING_RE.finditer(text))
        for i, m in enumerate(matches):
            start = m.start()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            title = m.group(2).strip()
            level = len(m.group(1))
            sections.append(Section(title=title, level=level, char_start=start, char_end=end))
        return ParseResult(
            text=text,
            sections=sections,
            metadata={"format": "markdown", "heading_count": len(sections)},
        )
