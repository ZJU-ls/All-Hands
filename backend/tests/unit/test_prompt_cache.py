"""ADR 0017 · P3.C — prompt cache breakpoint annotation tests."""

from __future__ import annotations

from allhands.services.prompt_cache import (
    annotate_cache_breakpoints,
    strip_cache_markers,
)


def test_annotate_with_no_assistant_is_noop() -> None:
    msgs = [{"role": "user", "content": "hi"}]
    result = annotate_cache_breakpoints(msgs)
    assert result == [{"role": "user", "content": "hi"}]


def test_annotate_with_single_assistant_is_noop() -> None:
    msgs = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ]
    result = annotate_cache_breakpoints(msgs)
    # Only one assistant turn — nothing stable to cache yet.
    assert all("_cache_control" not in m for m in result)


def test_annotate_marks_second_to_last_assistant() -> None:
    msgs = [
        {"role": "user", "content": "u1"},
        {"role": "assistant", "content": "a1"},
        {"role": "user", "content": "u2"},
        {"role": "assistant", "content": "a2"},
        {"role": "user", "content": "u3"},
    ]
    result = annotate_cache_breakpoints(msgs)
    # a1 is second-to-last assistant → should be marked
    marked = [i for i, m in enumerate(result) if m.get("_cache_control") == "ephemeral"]
    assert marked == [1]
    # Ensure only ONE breakpoint (simple heuristic)
    assert sum(1 for m in result if m.get("_cache_control")) == 1


def test_strip_removes_marker() -> None:
    msgs = [
        {"role": "assistant", "content": "hi", "_cache_control": "ephemeral"},
    ]
    stripped = strip_cache_markers(msgs)
    assert stripped == [{"role": "assistant", "content": "hi"}]
