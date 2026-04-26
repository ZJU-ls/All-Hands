"""Per-model token pricing — used by ObservatoryService to estimate run cost.

Two-layer lookup (2026-04-27):
1. **DB overlay** (``model_prices`` table) — populated by an Agent (the
   ``price-curator`` skill) or admin via Meta Tool. Wins when set.
2. **Code seed** (``_PRICES`` below) — versioned with the repo. Acts as
   fallback so the platform has sane defaults out of the box.
3. Neither matches → ``0.0`` (the UI renders "—" rather than guessing).

Prices are USD per 1M tokens (input / output). When you update the seed,
include the source URL in the PR description; runtime overrides carry their
own ``source_url`` field on each row.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from allhands.core import ModelPriceEntry
from allhands.core.pricing import PRICE_SEED

if TYPE_CHECKING:
    from collections.abc import Iterable, Mapping


@dataclass(frozen=True)
class ModelPrice:
    input_per_million_usd: float
    output_per_million_usd: float


# View on PRICE_SEED · same shape as before, lets the resolver code stay
# unchanged. PRICE_SEED lives in ``core/`` so both the service and the
# execution-layer meta-tool executors can read it without crossing the
# forbidden ``execution -> services`` import direction.
_PRICES: dict[str, ModelPrice] = {
    ref: ModelPrice(in_usd, out_usd) for ref, (in_usd, out_usd) in PRICE_SEED.items()
}


# ────────────────────────────────────────────────────────────────────────
# Public API
# ────────────────────────────────────────────────────────────────────────


def estimate_cost_usd(
    model_ref: str | None,
    input_tokens: int,
    output_tokens: int,
    *,
    overlay: Mapping[str, ModelPrice] | None = None,
) -> float:
    """Best-effort cost estimate.

    ``overlay`` is the *runtime DB overlay snapshot* (already keyed by
    lowercased model_ref). Pass ``None`` to skip overlay (useful when the
    caller has no DB session — tests / pure aggregations). Missing model
    returns ``0.0``; the UI treats zero as "unknown" and shows "—".
    """
    if not model_ref:
        return 0.0
    price = _resolve(model_ref, overlay)
    if price is None:
        return 0.0
    return (
        input_tokens * price.input_per_million_usd / 1_000_000.0
        + output_tokens * price.output_per_million_usd / 1_000_000.0
    )


def overlay_from_entries(entries: Iterable[ModelPriceEntry]) -> dict[str, ModelPrice]:
    """Project DB rows to the lookup-friendly snapshot the resolver expects."""
    return {
        e.model_ref.lower().strip(): ModelPrice(e.input_per_million_usd, e.output_per_million_usd)
        for e in entries
    }


def list_all_with_source(
    overlay: Mapping[str, ModelPrice] | None = None,
    *,
    overlay_entries: Iterable[ModelPriceEntry] | None = None,
) -> list[ModelPriceEntry]:
    """All known prices · DB rows + code-seed rows that are *not* overridden.

    Useful for the read-only price page and the ``list_model_prices`` Meta
    Tool. Caller passes both ``overlay`` (for the projection) and the raw
    ``overlay_entries`` (carries metadata like ``source_url`` / ``note`` /
    ``updated_at``). When entries are passed, overlay can be derived from
    them — both args are accepted for caller convenience.
    """
    if overlay_entries is None:
        ov_entries: list[ModelPriceEntry] = []
    else:
        ov_entries = list(overlay_entries)

    if overlay is None:
        overlay = overlay_from_entries(ov_entries)

    out: list[ModelPriceEntry] = []
    seen: set[str] = set()
    for e in ov_entries:
        out.append(e)
        seen.add(e.model_ref.lower().strip())

    for k, v in _PRICES.items():
        if k in seen:
            continue
        out.append(
            ModelPriceEntry(
                model_ref=k,
                input_per_million_usd=v.input_per_million_usd,
                output_per_million_usd=v.output_per_million_usd,
                source="code",
            )
        )

    out.sort(key=lambda e: (e.source == "code", e.model_ref))
    return out


# ────────────────────────────────────────────────────────────────────────
# Internal resolver
# ────────────────────────────────────────────────────────────────────────


def _resolve(model_ref: str, overlay: Mapping[str, ModelPrice] | None) -> ModelPrice | None:
    norm = model_ref.lower().strip()
    suffix = norm.split("/", 1)[-1] if "/" in norm else norm

    # 1. DB overlay wins · check full ref then suffix.
    if overlay:
        if norm in overlay:
            return overlay[norm]
        if suffix in overlay:
            return overlay[suffix]
        best_ov = _longest_prefix_match(suffix, overlay)
        if best_ov is not None:
            return best_ov

    # 2. Code seed.
    if norm in _PRICES:
        return _PRICES[norm]
    if suffix in _PRICES:
        return _PRICES[suffix]
    return _longest_prefix_match(suffix, _PRICES)


def _longest_prefix_match(suffix: str, table: Mapping[str, ModelPrice]) -> ModelPrice | None:
    best: ModelPrice | None = None
    best_len = 0
    for k, v in table.items():
        if suffix.startswith(k) and len(k) > best_len:
            best = v
            best_len = len(k)
    return best
