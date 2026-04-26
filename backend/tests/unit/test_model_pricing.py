"""Unit tests for the two-layer model_pricing lookup."""

from __future__ import annotations

from datetime import UTC, datetime

from allhands.core import ModelPriceEntry
from allhands.services.model_pricing import (
    ModelPrice,
    estimate_cost_usd,
    list_all_with_source,
    overlay_from_entries,
)


def test_resolve_uses_code_seed_when_no_overlay() -> None:
    cost = estimate_cost_usd("openai/gpt-4o-mini", 1_000_000, 0)
    # gpt-4o-mini code seed: $0.15 input / 1M
    assert abs(cost - 0.15) < 1e-9


def test_overlay_wins_over_code_seed() -> None:
    overlay = {"gpt-4o-mini": ModelPrice(0.05, 0.20)}  # promo price
    cost = estimate_cost_usd("openai/gpt-4o-mini", 1_000_000, 1_000_000, overlay=overlay)
    # 1M * 0.05 + 1M * 0.20 = 0.25
    assert abs(cost - 0.25) < 1e-9


def test_unknown_model_returns_zero() -> None:
    assert estimate_cost_usd("acme/unknown-99b", 100, 100) == 0.0


def test_provider_prefix_is_stripped() -> None:
    a = estimate_cost_usd("openai/gpt-4o", 1_000_000, 0)
    b = estimate_cost_usd("azure/gpt-4o", 1_000_000, 0)
    assert a == b > 0


def test_longest_prefix_match_handles_dated_suffix() -> None:
    # claude-haiku-4-5 in code seed; binding may carry "claude-haiku-4-5-20251001"
    cost = estimate_cost_usd("anthropic/claude-haiku-4-5-20251001", 1_000_000, 0)
    assert cost > 0


def test_overlay_from_entries_lowercases_keys() -> None:
    e = ModelPriceEntry(
        model_ref="OpenAI/GPT-4o",
        input_per_million_usd=2.5,
        output_per_million_usd=10.0,
        source="db",
    )
    overlay = overlay_from_entries([e])
    assert "openai/gpt-4o" in overlay


def test_list_all_with_source_merges_db_over_code() -> None:
    e = ModelPriceEntry(
        model_ref="gpt-4o-mini",
        input_per_million_usd=0.99,
        output_per_million_usd=1.99,
        source="db",
        source_url="https://openai.com/pricing",
        updated_at=datetime.now(UTC),
    )
    rows = list_all_with_source(overlay_entries=[e])
    db_row = next(r for r in rows if r.model_ref == "gpt-4o-mini")
    assert db_row.source == "db"
    assert db_row.input_per_million_usd == 0.99
    # Code-only entries still appear with source="code"
    code_rows = [r for r in rows if r.source == "code"]
    assert any(r.model_ref == "claude-opus-4-7" for r in code_rows)
    # No duplicate for the overridden one
    assert sum(1 for r in rows if r.model_ref == "gpt-4o-mini") == 1
