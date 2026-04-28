"""Image-generation domain models · L4 core · pydantic only.

Symmetric with ScriptInvocation/ScriptResult (skill_script.py): split the
*what to generate* from *how to call the upstream image API*. The execution
layer (image_provider.py) consumes these models and adapts to OpenAI / Imagen
/ DashScope wire formats; the tool layer adapts to the LLM tool protocol.

Layering (ADR 0011 § 7):
- This file only depends on pydantic + stdlib · no httpx · no I/O.
- Subclasses of ``ImageProvider`` (execution layer) consume these to issue
  real upstream calls.
- Pricing is encoded as a tiny pure dataclass so the tool layer can compute
  a cost estimate before firing (Confirmation Gate budget chip).

Reference:
- product/research/sandbox/IMAGE-GEN.html § 4 design
- ADR 0021 self-explaining tools (errors include {field, expected, hint})
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

# ─────────────────────────────────────────────────────────────────────────────
# Constants — agreed contract between provider impls and tool layer.
# ─────────────────────────────────────────────────────────────────────────────

DEFAULT_SIZE = "1024x1024"
DEFAULT_QUALITY = "auto"
DEFAULT_N = 1
MAX_BATCH = 10
MAX_PROMPT_CHARS = 4000
MIN_PROMPT_CHARS = 3
MAX_IMAGE_BYTES = 20 * 1024 * 1024  # mirrors artifact image limit · 20MB


# Conservative whitelist · matches gpt-image-1.5 / Imagen / FLUX common sizes.
# Providers can accept "auto" and pick a default.
ALLOWED_SIZES: tuple[str, ...] = (
    "auto",
    "1024x1024",
    "1024x1536",
    "1536x1024",
    "512x512",
    "768x768",
    "2048x2048",
)


class ImageQuality(StrEnum):
    """Quality tier · mapped per-provider in execution layer.

    `auto` lets the provider decide (medium for OpenAI · standard for Imagen).
    """

    AUTO = "auto"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ImageGenerationRequest(BaseModel):
    """Single-prompt image-generation contract.

    For batch (e.g. 8 PPT slides), the tool layer issues N requests in
    parallel via asyncio.gather — each request stays atomic. This keeps the
    domain model focused (one prompt → one or more images) and lets the
    tool layer compose batching policy without polluting providers.
    """

    prompt: str = Field(
        ...,
        min_length=MIN_PROMPT_CHARS,
        max_length=MAX_PROMPT_CHARS,
        description="Natural-language image description.",
    )
    size: str = Field(
        default=DEFAULT_SIZE,
        description=f"One of {list(ALLOWED_SIZES)}",
    )
    quality: ImageQuality = Field(default=ImageQuality.AUTO)
    n: int = Field(
        default=DEFAULT_N,
        ge=1,
        le=4,
        description="How many variants from this single prompt (provider may cap).",
    )

    model_config = {"frozen": True}


class GeneratedImage(BaseModel):
    """One image produced by the provider.

    `data` is the raw bytes (will be base64-encoded by the tool layer when
    saving to artifact storage). `prompt` echoes back so the tool layer can
    track which image came from which prompt across a batch.
    """

    data: bytes
    mime_type: Literal["image/png", "image/jpeg", "image/webp"] = "image/png"
    prompt: str
    size: str
    revised_prompt: str | None = Field(
        default=None,
        description=(
            "OpenAI gpt-image returns a 'revised_prompt' that shows what the "
            "model actually rendered. None for providers that don't return it."
        ),
    )

    model_config = {"frozen": True, "arbitrary_types_allowed": True}


class ImageGenerationResult(BaseModel):
    """Outcome of one ImageGenerationRequest · always returns ≥ 1 image on success."""

    images: list[GeneratedImage] = Field(min_length=1)
    duration_ms: int = Field(ge=0)
    cost_usd: float | None = Field(default=None, ge=0)
    model_used: str
    provider_id: str

    model_config = {"frozen": True, "arbitrary_types_allowed": True}


# ─────────────────────────────────────────────────────────────────────────────
# Pricing — encoded as a small pure structure · tool layer queries it for the
# Confirmation Gate budget chip.
# ─────────────────────────────────────────────────────────────────────────────


class ImagePricing(BaseModel):
    """Per-image cost rough estimate · USD. Used for confirmation-time budget.

    Real billing comes from the provider invoice; we just want the agent /
    user to see "this batch will cost ~ $X" before approving.

    Numbers as of 2026.04 · update when pricing pages move:
    - https://openai.com/api/pricing/
    - https://cloud.google.com/vertex-ai/generative-ai/pricing
    """

    model_pattern: str = Field(
        ..., description="Substring match against model name · first match wins."
    )
    cost_per_image: dict[str, float] = Field(
        default_factory=dict,
        description=(
            "Map of `quality_size` → USD. Example: "
            '{"medium_1024x1024": 0.04, "high_1024x1024": 0.16}'
        ),
    )

    model_config = {"frozen": True}

    def estimate(self, *, quality: ImageQuality, size: str, n: int = 1) -> float | None:
        """Best-effort cost estimate · returns None when no pricing entry matches."""
        # Prefer exact (quality, size) · fall back to (quality, *) · then ('any', size).
        keys = (
            f"{quality.value}_{size}",
            f"{quality.value}_*",
            f"*_{size}",
            "*_*",
        )
        for k in keys:
            if k in self.cost_per_image:
                return round(self.cost_per_image[k] * n, 4)
        return None


# Rough catalogue · loaded by image_provider factory when it picks a model.
# Tool layer uses this to compute "this batch costs about $X" for the gate.
DEFAULT_PRICING: tuple[ImagePricing, ...] = (
    ImagePricing(
        model_pattern="gpt-image-1.5-mini",
        cost_per_image={
            "low_1024x1024": 0.011,
            "medium_1024x1024": 0.022,
            "high_1024x1024": 0.036,
            "*_*": 0.025,
        },
    ),
    ImagePricing(
        model_pattern="gpt-image-1.5",
        cost_per_image={
            "low_1024x1024": 0.02,
            "medium_1024x1024": 0.04,
            "high_1024x1024": 0.16,
            "auto_1024x1024": 0.04,
            "*_*": 0.05,
        },
    ),
    ImagePricing(
        model_pattern="gpt-image-1",
        cost_per_image={
            "low_1024x1024": 0.011,
            "medium_1024x1024": 0.042,
            "high_1024x1024": 0.167,
            "*_*": 0.05,
        },
    ),
    ImagePricing(
        model_pattern="dall-e-3",
        cost_per_image={
            "standard_1024x1024": 0.04,
            "hd_1024x1024": 0.08,
            "*_*": 0.04,
        },
    ),
    ImagePricing(
        model_pattern="wanx",  # 阿里通义万相
        cost_per_image={"*_*": 0.03},
    ),
)


def estimate_cost(
    *,
    model_name: str,
    quality: ImageQuality,
    size: str,
    n: int = 1,
) -> float | None:
    """Convenience wrapper · pick first matching pricing entry."""
    for entry in DEFAULT_PRICING:
        if entry.model_pattern in model_name:
            return entry.estimate(quality=quality, size=size, n=n)
    return None


__all__ = [
    "ALLOWED_SIZES",
    "DEFAULT_N",
    "DEFAULT_PRICING",
    "DEFAULT_QUALITY",
    "DEFAULT_SIZE",
    "MAX_BATCH",
    "MAX_IMAGE_BYTES",
    "MAX_PROMPT_CHARS",
    "MIN_PROMPT_CHARS",
    "GeneratedImage",
    "ImageGenerationRequest",
    "ImageGenerationResult",
    "ImagePricing",
    "ImageQuality",
    "estimate_cost",
]
