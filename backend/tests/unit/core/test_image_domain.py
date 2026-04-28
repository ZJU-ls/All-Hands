"""core/image.py · pydantic-only domain model tests.

Covers:
- ImageGenerationRequest field validation
- ImageQuality enum + AUTO sentinel
- ImagePricing.estimate fallback chain
- estimate_cost wrapper

No I/O · no httpx · no asyncio.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from allhands.core.image import (
    ALLOWED_SIZES,
    DEFAULT_PRICING,
    MAX_BATCH,
    GeneratedImage,
    ImageGenerationRequest,
    ImageGenerationResult,
    ImagePricing,
    ImageQuality,
    estimate_cost,
)


def test_request_minimal_ok() -> None:
    r = ImageGenerationRequest(prompt="a cat")
    assert r.size == "1024x1024"
    assert r.quality is ImageQuality.AUTO
    assert r.n == 1


def test_request_rejects_short_prompt() -> None:
    with pytest.raises(ValidationError):
        ImageGenerationRequest(prompt="hi")  # below MIN_PROMPT_CHARS=3


def test_request_rejects_prompt_too_long() -> None:
    with pytest.raises(ValidationError):
        ImageGenerationRequest(prompt="x" * 5000)


def test_request_rejects_n_zero_or_too_high() -> None:
    with pytest.raises(ValidationError):
        ImageGenerationRequest(prompt="cat", n=0)
    with pytest.raises(ValidationError):
        ImageGenerationRequest(prompt="cat", n=10)


def test_request_frozen() -> None:
    r = ImageGenerationRequest(prompt="cat")
    with pytest.raises(ValidationError):
        r.prompt = "dog"  # type: ignore[misc]


def test_quality_enum_values() -> None:
    assert ImageQuality.AUTO.value == "auto"
    assert {q.value for q in ImageQuality} == {"auto", "low", "medium", "high"}


def test_size_whitelist_includes_common_sizes() -> None:
    assert "1024x1024" in ALLOWED_SIZES
    assert "1024x1536" in ALLOWED_SIZES
    assert "auto" in ALLOWED_SIZES


def test_max_batch_constant() -> None:
    # Sanity · pricing chip wants this number, OpenAI accepts ≤ 10
    assert MAX_BATCH == 10


# ─────────────────────────────────────────────────────────────────
# Result
# ─────────────────────────────────────────────────────────────────


def test_result_requires_at_least_one_image() -> None:
    with pytest.raises(ValidationError):
        ImageGenerationResult(images=[], duration_ms=10, model_used="x", provider_id="y")


def test_result_serializes_with_bytes() -> None:
    img = GeneratedImage(data=b"\x89PNGfake", mime_type="image/png", prompt="x", size="1024x1024")
    r = ImageGenerationResult(
        images=[img], duration_ms=10, cost_usd=0.04, model_used="m", provider_id="p"
    )
    payload = r.model_dump(exclude_none=True)
    assert payload["cost_usd"] == 0.04
    assert payload["model_used"] == "m"


# ─────────────────────────────────────────────────────────────────
# Pricing
# ─────────────────────────────────────────────────────────────────


def test_pricing_exact_match() -> None:
    p = ImagePricing(
        model_pattern="gpt-image-1.5",
        cost_per_image={"medium_1024x1024": 0.04, "high_1024x1024": 0.16},
    )
    assert p.estimate(quality=ImageQuality.MEDIUM, size="1024x1024") == 0.04
    assert p.estimate(quality=ImageQuality.HIGH, size="1024x1024") == 0.16


def test_pricing_fallback_to_wildcard() -> None:
    p = ImagePricing(model_pattern="x", cost_per_image={"*_*": 0.05, "high_*": 0.10})
    # exact miss · matches "high_*"
    assert p.estimate(quality=ImageQuality.HIGH, size="2048x2048") == 0.10
    # quality + size both miss · matches "*_*"
    assert p.estimate(quality=ImageQuality.LOW, size="2048x2048") == 0.05


def test_pricing_no_match_returns_none() -> None:
    p = ImagePricing(model_pattern="x", cost_per_image={"medium_512x512": 0.01})
    assert p.estimate(quality=ImageQuality.HIGH, size="2048x2048") is None


def test_pricing_n_multiplies() -> None:
    p = ImagePricing(model_pattern="x", cost_per_image={"*_*": 0.10})
    assert p.estimate(quality=ImageQuality.AUTO, size="1024x1024", n=4) == 0.40


def test_estimate_cost_wrapper_picks_first_pattern() -> None:
    cost = estimate_cost(model_name="gpt-image-1.5", quality=ImageQuality.MEDIUM, size="1024x1024")
    assert cost == 0.04


def test_estimate_cost_unknown_model_returns_none() -> None:
    cost = estimate_cost(
        model_name="unknown-future-model", quality=ImageQuality.AUTO, size="1024x1024"
    )
    assert cost is None


def test_default_pricing_is_a_tuple_of_pricing_entries() -> None:
    """Sanity · refactor would be obvious if pricing were ever made mutable."""
    assert isinstance(DEFAULT_PRICING, tuple)
    assert all(isinstance(p, ImagePricing) for p in DEFAULT_PRICING)
    # gpt-image-1.5 must be present (we ship it as the recommended default)
    assert any("gpt-image-1.5" in p.model_pattern for p in DEFAULT_PRICING)
