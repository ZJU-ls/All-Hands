"""Heading-aware chunker with recursive character-splitter fallback.

Strategy:

1. If the parser produced sections, walk them in order. For each section
   whose body is small enough (≤ max_chars), emit one chunk carrying its
   heading path. For oversized sections, fall through to splitter.
2. Splitter: recursive on a priority list of separators
   (`\\n\\n`, `\\n`, `. `, ` `), with a target window of `chunk_chars`
   characters and `overlap_chars` overlap to preserve context across
   boundaries. Token count is approximated as char_count // 4 — close
   enough for English / latin scripts; CJK runs cheaper, so chunks of
   pure CJK end up undercounting (acceptable for v0).
3. Each emitted chunk records (text, ordinal, span_start, span_end,
   section_path, page) so retrieval can attach a citation that points
   back to the exact location in the source.

Why not LangChain's text splitter:
- One less dep + we get to control overlap behavior for our citation
  use-case (we don't want overlap to muddy span_start values).
- Pure-stdlib keeps L5 lean.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

from allhands.execution.knowledge.parsers import ParseResult, Section


@dataclass(frozen=True)
class ChunkerConfig:
    chunk_chars: int = 1200  # ~300 tokens
    overlap_chars: int = 150
    max_section_chars: int = 1500  # sections under this stay one chunk
    min_chunk_chars: int = 80  # below this, merge into prev (skip noise)


@dataclass(frozen=True)
class ChunkSpec:
    """What `Chunker.split` yields. Plain dataclass to keep the type
    transport-friendly; the persistence layer turns it into rows."""

    ordinal: int
    text: str
    token_count: int
    section_path: str | None
    span_start: int
    span_end: int
    page: int | None
    extra_metadata: dict[str, object]

    def with_ordinal(self, new_ordinal: int) -> ChunkSpec:
        return ChunkSpec(
            ordinal=new_ordinal,
            text=self.text,
            token_count=self.token_count,
            section_path=self.section_path,
            span_start=self.span_start,
            span_end=self.span_end,
            page=self.page,
            extra_metadata=self.extra_metadata,
        )


class Chunker:
    def __init__(self, config: ChunkerConfig | None = None) -> None:
        self.cfg = config or ChunkerConfig()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def split(self, parsed: ParseResult) -> list[ChunkSpec]:
        if parsed.sections:
            return list(self._split_with_sections(parsed))
        return list(self._split_plain(parsed.text, base_path=None, page=None))

    # ------------------------------------------------------------------
    # Section-aware path
    # ------------------------------------------------------------------

    def _split_with_sections(self, parsed: ParseResult) -> Iterator[ChunkSpec]:
        ordinal = 0
        path_stack: list[Section] = []
        # Sentinel "tail" that catches the leading text before the first heading
        if parsed.sections and parsed.sections[0].char_start > 0:
            head = parsed.text[: parsed.sections[0].char_start].strip()
            if len(head) >= self.cfg.min_chunk_chars:
                for spec in self._split_plain(head, base_path=None, page=None, base_offset=0):
                    yield spec.with_ordinal(ordinal)
                    ordinal += 1

        for sec in parsed.sections:
            # maintain heading-path stack
            while path_stack and path_stack[-1].level >= sec.level:
                path_stack.pop()
            path_stack.append(sec)
            section_path = " > ".join(s.title for s in path_stack)
            body = parsed.text[sec.char_start : sec.char_end]
            if len(body) <= self.cfg.max_section_chars:
                stripped = body.strip()
                if len(stripped) < self.cfg.min_chunk_chars:
                    continue
                yield ChunkSpec(
                    ordinal=ordinal,
                    text=stripped,
                    token_count=_approx_tokens(stripped),
                    section_path=section_path,
                    span_start=sec.char_start,
                    span_end=sec.char_end,
                    page=sec.page,
                    extra_metadata={"heading_level": sec.level},
                )
                ordinal += 1
            else:
                for spec in self._split_plain(
                    body,
                    base_path=section_path,
                    page=sec.page,
                    base_offset=sec.char_start,
                ):
                    yield spec.with_ordinal(ordinal)
                    ordinal += 1

    # ------------------------------------------------------------------
    # Plain recursive splitter
    # ------------------------------------------------------------------

    def _split_plain(
        self,
        text: str,
        *,
        base_path: str | None,
        page: int | None,
        base_offset: int = 0,
    ) -> Iterator[ChunkSpec]:
        text = text.strip()
        if not text:
            return
        windows = list(_recursive_split(text, self.cfg.chunk_chars, self.cfg.overlap_chars))
        for ord_idx, (win_text, win_start) in enumerate(windows):
            if len(win_text) < self.cfg.min_chunk_chars and ord_idx > 0:
                continue
            yield ChunkSpec(
                ordinal=ord_idx,
                text=win_text,
                token_count=_approx_tokens(win_text),
                section_path=base_path,
                span_start=base_offset + win_start,
                span_end=base_offset + win_start + len(win_text),
                page=page,
                extra_metadata={},
            )


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------


def _approx_tokens(text: str) -> int:
    """Rough char→token estimate (4 chars/token for latin; closer to
    1.5 chars/token for CJK so this undercounts pure CJK runs).

    Good enough for budgeting display / cost estimation; not used as a
    truncation gate.
    """
    return max(1, len(text) // 4)


_SEPARATORS = ("\n\n", "\n", ". ", " ", "")


def _recursive_split(text: str, target_chars: int, overlap_chars: int) -> Iterator[tuple[str, int]]:
    """Yield (window_text, char_offset_in_input) windows.

    Tries to split on the highest-priority separator that produces
    pieces ≤ target_chars; if none works (e.g. a single long word),
    falls through to the empty separator and slices on character count.
    Overlap is taken by walking back ``overlap_chars`` from the new
    window's start, snapped to a separator if possible.
    """
    if len(text) <= target_chars:
        yield text, 0
        return

    pieces: list[tuple[str, int]] = []
    cursor = 0
    while cursor < len(text):
        end = min(cursor + target_chars, len(text))
        if end >= len(text):
            pieces.append((text[cursor:end], cursor))
            break
        # snap end back to a separator within the window
        chosen_end = end
        for sep in _SEPARATORS:
            if not sep:
                break
            idx = text.rfind(sep, cursor + target_chars // 2, end)
            if idx != -1:
                chosen_end = idx + len(sep)
                break
        pieces.append((text[cursor:chosen_end], cursor))
        # advance cursor with overlap
        next_cursor = max(chosen_end - overlap_chars, cursor + 1)
        # snap overlap start to a whitespace if possible
        snap = text.rfind(" ", next_cursor, chosen_end)
        cursor = snap + 1 if snap != -1 else next_cursor

    yield from pieces


__all__ = ["ChunkSpec", "Chunker", "ChunkerConfig"]
