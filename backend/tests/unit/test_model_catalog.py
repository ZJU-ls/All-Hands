"""Curated model catalog · lookup heuristic tests.

The catalog has to be forgiving: users type real names with date suffixes,
"-latest", or just guess. We rank: exact > alias > prefix > substring.
"""

from __future__ import annotations

from allhands.core.model import Capability
from allhands.core.model_catalog import CATALOG, lookup_catalog


def test_exact_match() -> None:
    e = lookup_catalog("gpt-4o-mini")
    assert e is not None
    assert e.name == "gpt-4o-mini"
    assert Capability.CHAT in e.capabilities


def test_case_insensitive() -> None:
    assert lookup_catalog("GPT-4O-MINI") is not None
    assert lookup_catalog("Claude-Opus-4-7") is not None


def test_alias_match() -> None:
    e = lookup_catalog("claude-3-5-sonnet-latest")
    assert e is not None
    assert e.name == "claude-3-5-sonnet"


def test_prefix_match_dated_snapshot() -> None:
    """Real-world: provider returns name with date suffix."""
    e = lookup_catalog("gpt-4o-mini-2024-07-18")
    assert e is not None
    assert e.name == "gpt-4o-mini"


def test_longest_prefix_wins() -> None:
    """gpt-4o-mini is longer than gpt-4o, must beat it."""
    e = lookup_catalog("gpt-4o-mini-some-suffix")
    assert e is not None
    assert e.name == "gpt-4o-mini"


def test_substring_fallback() -> None:
    """Mid-string match when prefix doesn't apply."""
    e = lookup_catalog("custom-qwen-max-tag")
    assert e is not None
    assert e.name == "qwen-max"


def test_unknown_returns_none() -> None:
    assert lookup_catalog("totally-fake-model-xyz") is None
    assert lookup_catalog("") is None
    assert lookup_catalog("   ") is None


def test_image_capability_for_wanx() -> None:
    e = lookup_catalog("wan2.5-t2i-preview")
    assert e is not None
    assert e.capabilities == [Capability.IMAGE_GEN]


def test_embedding_capability() -> None:
    e = lookup_catalog("text-embedding-3-small")
    assert e is not None
    assert e.capabilities == [Capability.EMBEDDING]


def test_speech_capability() -> None:
    e = lookup_catalog("tts-1")
    assert e is not None
    assert e.capabilities == [Capability.SPEECH]


def test_provider_kind_filter_excludes_wrong_provider() -> None:
    """Typing 'qwen-max' against an OpenAI provider should miss."""
    assert lookup_catalog("qwen-max", provider_kind="openai") is None
    e = lookup_catalog("qwen-max", provider_kind="aliyun")
    assert e is not None and e.name == "qwen-max"


def test_provider_kind_filter_allows_unrestricted_entries() -> None:
    """An entry with empty provider_kinds matches any provider."""
    # All current entries are restricted, but the function logic should
    # still allow None provider_kind to match anything.
    assert lookup_catalog("gpt-4o", provider_kind=None) is not None


def test_no_duplicate_names() -> None:
    names = [e.name for e in CATALOG]
    assert len(names) == len(set(names)), "duplicate name in CATALOG"


def test_all_entries_have_capabilities() -> None:
    for e in CATALOG:
        assert e.capabilities, f"{e.name} has empty capabilities"
