"""MarketDataRouter capability dispatch + fallback."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import ClassVar, Literal

import pytest

from allhands.core.market import Quote
from allhands.execution.market.base import (
    Capability,
    MarketDataProvider,
    ProviderNotSupported,
    RateLimitError,
)
from allhands.execution.market.router import (
    MarketDataRouter,
    NoProviderAvailableError,
)


class _FakeQuoteProvider(MarketDataProvider):
    id: ClassVar[str] = "fake"
    tier: ClassVar[Literal["free", "paid"]] = "free"
    capabilities: ClassVar[set[Capability]] = {Capability.QUOTE}

    def __init__(self, value: str, *, raise_: Exception | None = None) -> None:
        self.value = value
        self._raise = raise_
        self.calls: int = 0

    async def get_quote(self, symbol: str) -> Quote:
        self.calls += 1
        if self._raise is not None:
            raise self._raise
        return Quote(
            symbol=symbol,
            last=Decimal(self.value),
            ts=datetime.now(UTC),
            source=self.id,
        )


class _OtherProvider(_FakeQuoteProvider):
    id = "other"


@pytest.mark.asyncio
async def test_router_respects_priority() -> None:
    primary = _FakeQuoteProvider("100")
    secondary = _OtherProvider("200")
    router = MarketDataRouter([secondary, primary], priority=["fake", "other"])
    quote = await router.quote("SSE:600519")
    assert quote.source == "fake"
    assert primary.calls == 1
    assert secondary.calls == 0


@pytest.mark.asyncio
async def test_router_falls_through_on_rate_limit() -> None:
    primary = _FakeQuoteProvider("X", raise_=RateLimitError("slow down"))
    backup = _OtherProvider("42")
    router = MarketDataRouter([primary, backup], priority=["fake", "other"])
    quote = await router.quote("SSE:600519")
    assert quote.source == "other"
    assert quote.last == Decimal("42")


@pytest.mark.asyncio
async def test_router_falls_through_on_not_supported() -> None:
    primary = _FakeQuoteProvider("X", raise_=ProviderNotSupported("nope"))
    backup = _OtherProvider("7")
    router = MarketDataRouter([primary, backup], priority=["fake", "other"])
    quote = await router.quote("SSE:600519")
    assert quote.source == "other"


@pytest.mark.asyncio
async def test_router_raises_when_nobody_can_serve() -> None:
    router = MarketDataRouter([], priority=[])
    with pytest.raises(NoProviderAvailableError):
        await router.quote("SSE:600519")


@pytest.mark.asyncio
async def test_quote_batch_skips_missing() -> None:
    sole = _FakeQuoteProvider("10")
    router = MarketDataRouter([sole], priority=["fake"])
    result = await router.quote_batch(["A", "B", "C"])
    assert set(result.keys()) == {"A", "B", "C"}


@pytest.mark.asyncio
async def test_news_fallback_returns_empty_when_unsupported() -> None:
    router = MarketDataRouter([_FakeQuoteProvider("1")], priority=["fake"])
    # fake provider only has QUOTE capability — news should fall through to []
    result = await router.news(None, datetime.now(UTC))
    assert result == []
