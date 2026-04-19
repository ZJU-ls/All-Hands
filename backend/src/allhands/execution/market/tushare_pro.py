"""tushare.pro stub (spec § 4.3). Paid provider — v0 placeholder."""

from __future__ import annotations

from typing import ClassVar, Literal

from allhands.core.market import Quote
from allhands.execution.market.base import (
    Capability,
    MarketDataProvider,
    ProviderNotSupported,
)


class TushareProProvider(MarketDataProvider):
    id: ClassVar[str] = "tushare_pro"
    tier: ClassVar[Literal["free", "paid"]] = "paid"
    capabilities: ClassVar[set[Capability]] = set()

    async def get_quote(self, symbol: str) -> Quote:
        raise ProviderNotSupported(
            "tushare_pro is a v0 stub — register an API token and upgrade in v1"
        )


__all__ = ["TushareProProvider"]
