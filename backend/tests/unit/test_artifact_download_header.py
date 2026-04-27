"""Regression for the Content-Disposition header on artifact downloads.

Symptom: GET /api/artifacts/{id}/content?download=true returned a 500
("Internal Server Error", 21 bytes) for any artifact whose name contains
non-ASCII characters (CJK / accented / emoji). HTTP headers are latin-1;
shoving Chinese into `filename="..."` exploded inside starlette before
the response left the worker.

Fix: emit RFC 6266 / 5987 dual form — an ASCII-safe fallback plus
`filename*=UTF-8''<percent-encoded>`. Modern browsers prefer the
`filename*` variant and render the original name correctly; legacy
clients fall back to the sanitised ASCII version.

These tests pin the header shape so future header tweaks don't
regress to the broken single-`filename=` form.
"""

from __future__ import annotations

import re

from allhands.api.routers.artifacts import _content_disposition


def _parse_filenames(header: str) -> tuple[str, str]:
    """Pull both filename / filename* fields out of one header string."""
    plain = re.search(r'filename="([^"]+)"', header)
    encoded = re.search(r"filename\*=UTF-8''(\S+)", header)
    assert plain, f"no plain filename in {header!r}"
    assert encoded, f"no filename* in {header!r}"
    return plain.group(1), encoded.group(1)


def test_ascii_only_name_round_trips() -> None:
    header = _content_disposition("report.pptx")
    assert header.startswith("attachment; ")
    plain, encoded = _parse_filenames(header)
    assert plain == "report.pptx"
    assert encoded == "report.pptx"
    # Header must be latin-1 safe — this is the actual root cause of the bug
    header.encode("latin-1")


def test_chinese_name_does_not_break_header_encoding() -> None:
    header = _content_disposition("AllHands-产品战略与路线图.pptx")
    # If this raises UnicodeEncodeError, the bug is back.
    header.encode("latin-1")

    plain, encoded = _parse_filenames(header)
    # Plain fallback collapses CJK to underscores · keeps the extension
    assert plain.endswith(".pptx")
    assert "AllHands-" in plain
    # Encoded form percent-encodes UTF-8 bytes of "产品战略与路线图"
    assert "%E4%BA%A7" in encoded  # "产" UTF-8 bytes
    assert encoded.endswith(".pptx")


def test_emoji_name_safe() -> None:
    header = _content_disposition("🎉 launch deck.pptx")
    header.encode("latin-1")
    plain, _ = _parse_filenames(header)
    assert "launch deck.pptx" in plain or "_launch deck.pptx" in plain


def test_blank_name_falls_back_to_download() -> None:
    header = _content_disposition("   ")
    plain, _ = _parse_filenames(header)
    assert plain == "download"


def test_quote_in_name_does_not_escape_attribute() -> None:
    """A double quote in the name would break the `filename="..."`
    quoting and inject extra header attributes. Sanitiser must drop
    anything outside the safe set."""
    header = _content_disposition('weird "name".pptx')
    plain, _ = _parse_filenames(header)
    assert '"' not in plain
    # Header still parses cleanly · only one filename= field
    assert header.count("filename=") == 1


def test_path_traversal_chars_sanitised() -> None:
    header = _content_disposition("../../etc/passwd")
    plain, _ = _parse_filenames(header)
    # Slashes and dots get collapsed; the dangerous payload is gone.
    assert "/" not in plain


def test_whitespace_collapses_but_keeps_extension() -> None:
    """Spaces inside names are common · they survive."""
    header = _content_disposition("Q1 review deck.pptx")
    plain, _ = _parse_filenames(header)
    assert plain == "Q1 review deck.pptx"
