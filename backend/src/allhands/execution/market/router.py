"""MarketDataRouter — capability-based provider fan-out (spec § 4.4).

Priority-ordered lookup: for every supported capability method we try each
provider in order until one returns or we exhaust the list. ``ProviderNotSupported``
is swallowed (expected fall-through); ``RateLimitError`` / ``TransientError``
are swallowed and moved to the next provider; other exceptions bubble up so
bugs are visible.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import TYPE_CHECKING

from allhands.core.market import (
    Announcement,
    Bar,
    Interval,
    NewsItem,
    Quote,
    ScreenCriteria,
    Symbol,
)
from allhands.execution.market.base import (
    Capability,
    ProviderError,
    ProviderNotSupported,
    RateLimitError,
    TransientError,
)

if TYPE_CHECKING:
    from allhands.execution.market.base import MarketDataProvider

logger = logging.getLogger(__name__)


class NoProviderAvailableError(ProviderError):
    def __init__(self, capability: str, symbol: str | None = None) -> None:
        msg = f"no provider available for {capability}"
        if symbol:
            msg += f" ({symbol})"
        super().__init__(msg)


class MarketDataRouter:
    """Route calls across providers ordered by ``priority``."""

    def __init__(
        self,
        providers: list[MarketDataProvider],
        priority: list[str],
    ) -> None:
        self._providers = providers
        self._priority = priority

    def _sorted_for(self, capability: Capability) -> list[MarketDataProvider]:
        index = {pid: i for i, pid in enumerate(self._priority)}
        eligible = [p for p in self._providers if capability in p.capabilities]
        eligible.sort(key=lambda p: index.get(p.id, 1_000))
        return eligible

    async def quote(self, symbol: str) -> Quote:
        for provider in self._sorted_for(Capability.QUOTE):
            try:
                return await provider.get_quote(symbol)
            except (ProviderNotSupported, RateLimitError, TransientError):
                logger.debug(
                    "market.provider.fallback",
                    extra={"provider": provider.id, "symbol": symbol},
                )
                continue
        raise NoProviderAvailableError("quote", symbol)

    async def quote_batch(self, symbols: list[str]) -> dict[str, Quote]:
        quotes: dict[str, Quote] = {}
        for symbol in symbols:
            try:
                quotes[symbol] = await self.quote(symbol)
            except NoProviderAvailableError:
                continue
        return quotes

    async def bars(
        self,
        symbol: str,
        interval: Interval,
        start: datetime,
        end: datetime,
    ) -> list[Bar]:
        for provider in self._sorted_for(Capability.BARS):
            try:
                return await provider.get_bars(symbol, interval, start, end)
            except (ProviderNotSupported, RateLimitError, TransientError):
                continue
        raise NoProviderAvailableError("bars", symbol)

    async def news(
        self,
        symbol: str | None,
        since: datetime,
        *,
        limit: int = 50,
    ) -> list[NewsItem]:
        for provider in self._sorted_for(Capability.NEWS):
            try:
                return await provider.get_news(symbol, since, limit=limit)
            except (ProviderNotSupported, RateLimitError, TransientError):
                continue
        return []

    async def announcements(
        self,
        symbol: str,
        since: datetime,
        *,
        limit: int = 50,
    ) -> list[Announcement]:
        for provider in self._sorted_for(Capability.ANNOUNCEMENTS):
            try:
                return await provider.get_announcements(symbol, since, limit=limit)
            except (ProviderNotSupported, RateLimitError, TransientError):
                continue
        return []

    async def search(self, query: str, *, limit: int = 10) -> list[Symbol]:
        for provider in self._sorted_for(Capability.SEARCH):
            try:
                return await provider.search_symbol(query, limit=limit)
            except (ProviderNotSupported, RateLimitError, TransientError):
                continue
        return []

    async def screen(self, criteria: ScreenCriteria) -> list[Symbol]:
        for provider in self._sorted_for(Capability.SCREEN):
            try:
                return await provider.screen(criteria)
            except (ProviderNotSupported, RateLimitError, TransientError):
                continue
        return []

    @property
    def providers(self) -> list[MarketDataProvider]:
        return list(self._providers)


__all__ = ["MarketDataRouter", "NoProviderAvailableError"]
