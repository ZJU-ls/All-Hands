"""Domain types for per-model token pricing.

Two layers:
- **Code seed** in ``services/model_pricing.py`` — versioned with the repo,
  ships sane defaults (OpenAI, Anthropic, 百炼, DeepSeek).
- **DB overlay** in the ``model_prices`` table — populated at runtime by an
  Agent (price-curator skill) or admin; overrides the code value when set.

The lookup order is **DB → code → 0.0**; ``0.0`` means "unknown" and the UI
displays "—" rather than guessing wrong.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

PriceSource = Literal["code", "db"]


# Per-model token pricing seed · USD per 1M tokens (input, output).
# Versioned with the codebase. The DB ``model_prices`` table can override
# any of these at runtime — when set, the DB row wins (see
# ``services/model_pricing.estimate_cost_usd``).
#
# Lives in ``core/`` (not ``services/``) so the execution layer's meta-tool
# executors can mirror the seed without violating the layered import
# contract (execution → services is forbidden). The list is also the single
# source of truth that the read-only price page renders.
PRICE_SEED: dict[str, tuple[float, float]] = {
    # OpenAI · https://openai.com/pricing
    "gpt-4o": (2.50, 10.00),
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4.1": (2.00, 8.00),
    "gpt-4.1-mini": (0.40, 1.60),
    "o1": (15.00, 60.00),
    "o1-mini": (3.00, 12.00),
    "o3": (2.00, 8.00),
    "o3-mini": (1.10, 4.40),
    # Anthropic · https://www.anthropic.com/pricing
    "claude-opus-4-7": (15.00, 75.00),
    "claude-opus-4-6": (15.00, 75.00),
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-haiku-4-5": (1.00, 5.00),
    "claude-3-5-sonnet": (3.00, 15.00),
    "claude-3-5-haiku": (0.80, 4.00),
    # DashScope · 阿里百炼
    "qwen-max": (2.80, 8.40),
    "qwen-plus": (0.40, 1.20),
    "qwen-turbo": (0.30, 0.60),
    # DeepSeek
    "deepseek-chat": (0.27, 1.10),
    "deepseek-reasoner": (0.55, 2.19),
}


class ModelPriceEntry(BaseModel):
    """One pricing row · suitable for both code seed and DB overlay shapes.

    For code-seeded entries the metadata fields (``source_url`` / ``note`` /
    ``updated_at`` / ``updated_by_run_id``) are ``None``; the DB overlay sets
    them when an Agent or admin updates the row.
    """

    model_ref: str = Field(..., description="Same ref the LLMModel layer uses.")
    input_per_million_usd: float = Field(..., ge=0)
    output_per_million_usd: float = Field(..., ge=0)
    source: PriceSource = Field(..., description="code = built-in seed · db = runtime overlay")
    source_url: str | None = None
    note: str | None = None
    updated_at: datetime | None = None
    updated_by_run_id: str | None = None
