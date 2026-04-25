"""Chunker tests — heading-aware split + recursive fallback."""

from __future__ import annotations

from allhands.execution.knowledge.chunker import Chunker, ChunkerConfig
from allhands.execution.knowledge.parsers import ParseResult, Section


def _section_specs(parsed: ParseResult, *, min_chars: int = 10) -> list[tuple[str | None, str]]:
    chunks = Chunker(ChunkerConfig(min_chunk_chars=min_chars)).split(parsed)
    return [(c.section_path, c.text[:50]) for c in chunks]


def test_heading_aware_path_stack_walks_nested_sections() -> None:
    text = (
        "# Top\n\nintro paragraph one.\n\n"
        "## Middle A\n\nbody of A more text here.\n\n"
        "### Nested\n\nnested body content here.\n\n"
        "## Middle B\n\nbody of B too long.\n"
    )
    sections = [
        Section(title="Top", level=1, char_start=0, char_end=text.find("## Middle A")),
        Section(
            title="Middle A",
            level=2,
            char_start=text.find("## Middle A"),
            char_end=text.find("### Nested"),
        ),
        Section(
            title="Nested",
            level=3,
            char_start=text.find("### Nested"),
            char_end=text.find("## Middle B"),
        ),
        Section(
            title="Middle B",
            level=2,
            char_start=text.find("## Middle B"),
            char_end=len(text),
        ),
    ]
    parsed = ParseResult(text=text, sections=sections)
    specs = _section_specs(parsed)
    paths = [s for s, _ in specs]
    assert "Top > Middle A > Nested" in paths
    assert "Top > Middle B" in paths
    assert "Top > Middle A" in paths


def test_oversized_section_falls_through_to_recursive_splitter() -> None:
    big = "lorem ipsum dolor sit amet " * 200  # ~5400 chars
    text = f"# Big section\n\n{big}"
    parsed = ParseResult(
        text=text,
        sections=[Section(title="Big section", level=1, char_start=0, char_end=len(text))],
    )
    chunks = Chunker(ChunkerConfig(chunk_chars=600, max_section_chars=800)).split(parsed)
    assert len(chunks) >= 4
    # All carry the section path
    assert all(c.section_path == "Big section" for c in chunks)
    # Spans monotonically advance
    starts = [c.span_start for c in chunks]
    assert starts == sorted(starts)


def test_no_sections_uses_plain_recursive() -> None:
    text = "paragraph one.\n\nparagraph two.\n\nparagraph three."
    parsed = ParseResult(text=text, sections=[])
    chunks = Chunker(ChunkerConfig(min_chunk_chars=5)).split(parsed)
    assert len(chunks) == 1
    assert chunks[0].section_path is None
