"""Tests for the Artifact.Preview vs Artifact.Card envelope routing.

P1 of the artifacts unification (2026-04-26):
- INLINE_KINDS (html / drawio / mermaid / image / csv / data) → Preview
- CARD_ONLY_KINDS (pptx / docx) → Card
- markdown / code / xlsx → size-gated (Preview ≤ 200KB)
- pdf → size-gated (Preview ≤ 2MB)
- unknown → Card (safe default)
"""

from __future__ import annotations

import pytest

from allhands.execution.tools.meta.executors import (
    _artifact_create_result,
    _pick_artifact_envelope,
)


@pytest.mark.parametrize(
    "kind",
    ["html", "drawio", "mermaid", "image", "csv", "data"],
)
def test_inline_kinds_always_preview_regardless_of_size(kind: str) -> None:
    assert _pick_artifact_envelope(kind, 100) == "Artifact.Preview"
    assert _pick_artifact_envelope(kind, 5_000_000) == "Artifact.Preview"
    assert _pick_artifact_envelope(kind, None) == "Artifact.Preview"


@pytest.mark.parametrize("kind", ["pptx", "docx"])
def test_card_only_kinds_always_card(kind: str) -> None:
    assert _pick_artifact_envelope(kind, 100) == "Artifact.Card"
    assert _pick_artifact_envelope(kind, 5_000_000) == "Artifact.Card"


@pytest.mark.parametrize("kind", ["markdown", "code", "xlsx"])
def test_size_gated_text_kinds(kind: str) -> None:
    # under 200KB → Preview
    assert _pick_artifact_envelope(kind, 199_999) == "Artifact.Preview"
    assert _pick_artifact_envelope(kind, 0) == "Artifact.Preview"
    # over 200KB → Card
    assert _pick_artifact_envelope(kind, 200_001) == "Artifact.Card"
    assert _pick_artifact_envelope(kind, 1_000_000) == "Artifact.Card"
    # None → Preview (assume small)
    assert _pick_artifact_envelope(kind, None) == "Artifact.Preview"


def test_pdf_size_gated_at_2mb() -> None:
    assert _pick_artifact_envelope("pdf", 1_000_000) == "Artifact.Preview"
    assert _pick_artifact_envelope("pdf", 2_000_000) == "Artifact.Preview"
    assert _pick_artifact_envelope("pdf", 2_000_001) == "Artifact.Card"
    assert _pick_artifact_envelope("pdf", None) == "Artifact.Preview"


def test_unknown_kind_defaults_to_card() -> None:
    assert _pick_artifact_envelope("nonexistent", 100) == "Artifact.Card"
    assert _pick_artifact_envelope("", 100) == "Artifact.Card"


def test_create_result_carries_envelope_and_flat_fields() -> None:
    out = _artifact_create_result(
        artifact_id="abc",
        version=2,
        kind_value="html",
        size_bytes=1234,
    )
    assert out["component"] == "Artifact.Preview"
    assert out["props"] == {
        "artifact_id": "abc",
        "version": 2,
        "kind": "html",
    }
    assert out["interactions"] == []
    # flat fields for agent ergonomics
    assert out["artifact_id"] == "abc"
    assert out["version"] == 2
    assert out["kind"] == "html"


def test_create_result_pptx_routes_to_card() -> None:
    out = _artifact_create_result(
        artifact_id="abc",
        version=1,
        kind_value="pptx",
        size_bytes=5000,
    )
    assert out["component"] == "Artifact.Card"
    assert out["props"]["kind"] == "pptx"


def test_create_result_large_markdown_routes_to_card() -> None:
    out = _artifact_create_result(
        artifact_id="abc",
        version=1,
        kind_value="markdown",
        size_bytes=500_000,
    )
    assert out["component"] == "Artifact.Card"


def test_create_result_warnings_pass_through() -> None:
    out = _artifact_create_result(
        artifact_id="abc",
        version=1,
        kind_value="pptx",
        size_bytes=5000,
        warnings=["unknown layout 'foo' skipped"],
    )
    assert out["warnings"] == ["unknown layout 'foo' skipped"]
