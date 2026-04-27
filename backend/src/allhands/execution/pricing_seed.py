"""Tiny adapter so meta-tool executors can iterate the code-side price seed
without importing from ``services/`` (forbidden direction)."""

from __future__ import annotations

from collections.abc import Iterable

from allhands.core.pricing import PRICE_SEED


def iter_seed_entries() -> Iterable[tuple[str, float, float]]:
    """Yield ``(model_ref, input_per_million_usd, output_per_million_usd)``."""
    for ref, (in_usd, out_usd) in PRICE_SEED.items():
        yield ref, in_usd, out_usd
