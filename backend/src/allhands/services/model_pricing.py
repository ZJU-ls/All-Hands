"""Per-model token pricing — used by ObservatoryService to estimate run cost.

Self-instrumented · prices live in code rather than the DB so they're
versioned with the codebase. Update via PR when a provider's pricing
changes; missing entries fall back to ``0.0`` (cost shows as "—" in UI
rather than guessing wrong).

Prices are USD per 1M tokens (input / output). Sources tracked in PR
descriptions; this is a small whitelist on purpose — the registry is
exhaustive enough for the platform's default models and easy to extend.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelPrice:
    input_per_million_usd: float
    output_per_million_usd: float


# Keys are case-insensitive; we match on the *suffix* after the slash so
# "openai/gpt-4o-mini" and "azure/gpt-4o-mini" both resolve. When in doubt
# the FULL ref is checked first, then the model-name-only fallback.
_PRICES: dict[str, ModelPrice] = {
    # OpenAI · https://openai.com/pricing
    "gpt-4o": ModelPrice(2.50, 10.00),
    "gpt-4o-mini": ModelPrice(0.15, 0.60),
    "gpt-4.1": ModelPrice(2.00, 8.00),
    "gpt-4.1-mini": ModelPrice(0.40, 1.60),
    "o1": ModelPrice(15.00, 60.00),
    "o1-mini": ModelPrice(3.00, 12.00),
    "o3": ModelPrice(2.00, 8.00),
    "o3-mini": ModelPrice(1.10, 4.40),
    # Anthropic · https://www.anthropic.com/pricing
    "claude-opus-4-7": ModelPrice(15.00, 75.00),
    "claude-opus-4-6": ModelPrice(15.00, 75.00),
    "claude-sonnet-4-6": ModelPrice(3.00, 15.00),
    "claude-haiku-4-5": ModelPrice(1.00, 5.00),
    "claude-3-5-sonnet": ModelPrice(3.00, 15.00),
    "claude-3-5-haiku": ModelPrice(0.80, 4.00),
    # DashScope · 阿里百炼
    "qwen-max": ModelPrice(2.80, 8.40),
    "qwen-plus": ModelPrice(0.40, 1.20),
    "qwen-turbo": ModelPrice(0.30, 0.60),
    # DeepSeek
    "deepseek-chat": ModelPrice(0.27, 1.10),
    "deepseek-reasoner": ModelPrice(0.55, 2.19),
}


def estimate_cost_usd(
    model_ref: str | None,
    input_tokens: int,
    output_tokens: int,
) -> float:
    """Best-effort cost estimate. Returns ``0.0`` when the model isn't in
    the registry — the UI treats zero as "unknown" and shows "—"."""
    if not model_ref:
        return 0.0
    price = _resolve(model_ref)
    if price is None:
        return 0.0
    return (
        input_tokens * price.input_per_million_usd / 1_000_000.0
        + output_tokens * price.output_per_million_usd / 1_000_000.0
    )


def _resolve(model_ref: str) -> ModelPrice | None:
    norm = model_ref.lower().strip()
    if norm in _PRICES:
        return _PRICES[norm]
    # Strip provider prefix (``openai/``, ``anthropic/``, ``bailian/`` …)
    suffix = norm.split("/", 1)[-1] if "/" in norm else norm
    if suffix in _PRICES:
        return _PRICES[suffix]
    # Some bindings carry a date / variant suffix (claude-haiku-4-5-20251001).
    # Match on the longest prefix in the registry to handle those.
    best: ModelPrice | None = None
    best_len = 0
    for k, v in _PRICES.items():
        if suffix.startswith(k) and len(k) > best_len:
            best = v
            best_len = len(k)
    return best
