"""efinance stub (spec § 4.3). Redundant free provider."""

from __future__ import annotations

from typing import ClassVar, Literal

from allhands.core.market import Quote
from allhands.execution.market.base import (
    Capability,
    MarketDataProvider,
    ProviderNotSupported,
)


class EfinanceProvider(MarketDataProvider):
    id: ClassVar[str] = "efinance"
    tier: ClassVar[Literal["free", "paid"]] = "free"
    capabilities: ClassVar[set[Capability]] = set()

    async def get_quote(self, symbol: str) -> Quote:
        raise ProviderNotSupported(
            "efinance is a v0 stub — redundant free provider, enable when akshare rate-limits"
        )


__all__ = ["EfinanceProvider"]
