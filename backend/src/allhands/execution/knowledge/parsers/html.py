"""HTML parser — stdlib-only.

Strips tags via stdlib `html.parser` rather than pulling in BeautifulSoup
or trafilatura: zero new dep, predictable behavior, "good enough" for
clipped articles. Headings (`h1`..`h6`) become `Section`s with char
offsets so the chunker walks the heading tree the same way it does for
markdown / pdf.

Boilerplate (script / style) is dropped wholesale; nav / aside / footer
are kept because in many doc-clip use cases they carry useful context
(metadata, table-of-contents). M2 stretch can plug a "main-content
extractor" behind a flag if the resulting chunks are too noisy.
"""

from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path

from allhands.execution.knowledge.parsers import ParseResult, Section

_DROP_TAGS = frozenset({"script", "style", "noscript", "template"})
_HEADING_TAGS = {f"h{i}": i for i in range(1, 7)}


class _HTMLToText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.headings: list[tuple[int, str, int]] = []  # (level, title, char_offset)
        self._dropping = 0
        self._heading_level: int | None = None
        self._heading_buf: list[str] = []

    @property
    def out(self) -> str:
        return "".join(self.parts)

    def handle_starttag(self, tag: str, attrs: object) -> None:
        if tag in _DROP_TAGS:
            self._dropping += 1
            return
        if tag in _HEADING_TAGS:
            self._heading_level = _HEADING_TAGS[tag]
            self._heading_buf = []
            # Make sure the heading starts on its own line for chunker
            if self.parts and not self.parts[-1].endswith("\n"):
                self.parts.append("\n")
        if tag in {"p", "br", "li", "tr", "div", "section", "article"} and (
            self.parts and not self.parts[-1].endswith("\n")
        ):
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _DROP_TAGS:
            self._dropping = max(0, self._dropping - 1)
            return
        if tag in _HEADING_TAGS and self._heading_level is not None:
            title = " ".join("".join(self._heading_buf).split())
            if title:
                offset = sum(len(p) for p in self.parts)
                # Embed the heading text in the body so the chunker's
                # span ranges align with what FTS sees.
                marker = f"\n{title}\n"
                self.parts.append(marker)
                # Section anchors at the start of the marker (after first \n)
                self.headings.append((self._heading_level, title, offset + 1))
            self._heading_level = None
            self._heading_buf = []
            return
        if tag in {"p", "li", "tr", "section", "article"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._dropping:
            return
        if self._heading_level is not None:
            self._heading_buf.append(data)
            return
        self.parts.append(data)


class HtmlParser:
    mime_types: tuple[str, ...] = ("text/html",)

    def parse(self, file_path: str) -> ParseResult:
        raw = Path(file_path).read_text(encoding="utf-8", errors="replace")
        p = _HTMLToText()
        p.feed(raw)
        text = p.out
        sections: list[Section] = []
        for i, (level, title, start) in enumerate(p.headings):
            end = p.headings[i + 1][2] if i + 1 < len(p.headings) else len(text)
            sections.append(Section(title=title, level=level, char_start=start, char_end=end))
        return ParseResult(
            text=text,
            sections=sections,
            metadata={"format": "html", "heading_count": len(sections)},
        )
