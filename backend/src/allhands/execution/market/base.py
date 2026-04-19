"""MarketDataProvider ABC + capability enum (spec § 4.1).

A provider need only implement the capabilities it advertises; the router
skips unsupported methods. Unsupported calls raise ``ProviderNotSupported``
which the router converts to a fallback attempt.
"""

from __future__ import annotations

from abc import ABC
from datetime import datetime
from enum import StrEnum
from typing import ClassVar, Literal

from allhands.core.market import (
    Announcement,
    Bar,
    Interval,
    NewsItem,
    Quote,
    ScreenCriteria,
    Symbol,
)


class Capability(StrEnum):
    QUOTE = "quote"
    BARS = "bars"
    NEWS = "news"
    ANNOUNCEMENTS = "announcements"
    SEARCH = "search"
    SCREEN = "screen"


class ProviderError(Exception):
    """Base for provider errors."""


class ProviderNotSupported(ProviderError):
    """Raised when a capability isn't implemented — router tries next provider."""


class RateLimitError(ProviderError):
    """Provider said slow down."""


class TransientError(ProviderError):
    """Network blip; retry or fallback."""


class MarketDataProvider(ABC):
    """Capability-advertising adapter over one data source."""

    id: ClassVar[str]
    tier: ClassVar[Literal["free", "paid"]]
    capabilities: ClassVar[set[Capability]]

    async def get_quote(self, symbol: str) -> Quote:
        raise ProviderNotSupported(f"{self.id} does not implement get_quote")

    async def get_quote_batch(self, symbols: list[str]) -> list[Quote]:
        """Default: dispatch to ``get_quote`` one at a time; adapters with
        batch endpoints override."""
        quotes: list[Quote] = []
        for sym in symbols:
            try:
                quotes.append(await self.get_quote(sym))
            except ProviderError:
                continue
        return quotes

    async def get_bars(
        self,
        symbol: str,
        interval: Interval,
        start: datetime,
        end: datetime,
    ) -> list[Bar]:
        raise ProviderNotSupported(f"{self.id} does not implement get_bars")

    async def get_news(
        self,
        symbol: str | None,
        since: datetime,
        *,
        limit: int = 50,
    ) -> list[NewsItem]:
        raise ProviderNotSupported(f"{self.id} does not implement get_news")

    async def get_announcements(
        self,
        symbol: str,
        since: datetime,
        *,
        limit: int = 50,
    ) -> list[Announcement]:
        raise ProviderNotSupported(f"{self.id} does not implement get_announcements")

    async def search_symbol(self, query: str, *, limit: int = 10) -> list[Symbol]:
        raise ProviderNotSupported(f"{self.id} does not implement search_symbol")

    async def screen(self, criteria: ScreenCriteria) -> list[Symbol]:
        raise ProviderNotSupported(f"{self.id} does not implement screen")


__all__ = [
    "Capability",
    "MarketDataProvider",
    "ProviderError",
    "ProviderNotSupported",
    "RateLimitError",
    "TransientError",
]
