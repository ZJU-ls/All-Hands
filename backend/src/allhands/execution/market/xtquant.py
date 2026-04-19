"""xtquant (QMT) stub (spec § 4.3). Level-2 / broker terminal adapter."""

from __future__ import annotations

from typing import ClassVar, Literal

from allhands.core.market import Quote
from allhands.execution.market.base import (
    Capability,
    MarketDataProvider,
    ProviderNotSupported,
)


class XtQuantProvider(MarketDataProvider):
    id: ClassVar[str] = "xtquant"
    tier: ClassVar[Literal["free", "paid"]] = "paid"
    capabilities: ClassVar[set[Capability]] = set()

    async def get_quote(self, symbol: str) -> Quote:
        raise ProviderNotSupported(
            "xtquant is a v0 stub — requires a broker terminal + Level-2 license"
        )


__all__ = ["XtQuantProvider"]
