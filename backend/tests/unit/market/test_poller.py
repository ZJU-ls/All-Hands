"""Poller anomaly detection + publish path."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import ClassVar, Literal

import pytest

from allhands.core.market import MarketAnomalyEvent, PollerThresholds, Quote
from allhands.execution.market.base import Capability, MarketDataProvider
from allhands.execution.market.poller import MarketPoller, detect_anomaly
from allhands.execution.market.router import MarketDataRouter


def _q(last: str, vol: int = 0) -> Quote:
    return Quote(
        symbol="SSE:600519",
        last=Decimal(last),
        ts=datetime.now(UTC),
        source="test",
        volume=vol,
    )


def test_detect_anomaly_sudden_spike() -> None:
    prev = _q("100")
    cur = _q("103")
    thresholds = PollerThresholds(sudden_spike_pct=Decimal("2.0"))
    assert detect_anomaly(prev, cur, thresholds) == "sudden_spike"


def test_detect_anomaly_sudden_drop() -> None:
    thresholds = PollerThresholds(sudden_drop_pct=Decimal("-2.0"))
    assert detect_anomaly(_q("100"), _q("97"), thresholds) == "sudden_drop"


def test_detect_anomaly_crash_takes_priority() -> None:
    thresholds = PollerThresholds(crash_pct=Decimal("-5.0"), sudden_drop_pct=Decimal("-2.0"))
    assert detect_anomaly(_q("100"), _q("90"), thresholds) == "crash"


def test_detect_anomaly_limit_up_takes_priority() -> None:
    thresholds = PollerThresholds(limit_up_pct=Decimal("10.0"))
    assert detect_anomaly(_q("100"), _q("110"), thresholds) == "limit_up"


def test_detect_anomaly_none_when_below_threshold() -> None:
    thresholds = PollerThresholds(sudden_spike_pct=Decimal("5.0"))
    assert detect_anomaly(_q("100"), _q("102"), thresholds) is None


def test_detect_anomaly_volume_spike() -> None:
    thresholds = PollerThresholds(
        sudden_spike_pct=Decimal("10.0"),  # bigger than actual
        sudden_drop_pct=Decimal("-10.0"),
        volume_spike_sigma=Decimal("2.0"),
    )
    prev = _q("100", vol=1_000_000)
    cur = _q("101", vol=10_000_000)
    history = [1_000_000, 1_100_000, 900_000, 1_050_000, 950_000]
    assert detect_anomaly(prev, cur, thresholds, recent_volumes=history) == "volume_spike"


def test_detect_anomaly_prev_zero_returns_none() -> None:
    assert detect_anomaly(_q("0"), _q("1"), PollerThresholds()) is None


class _StubQuoter(MarketDataProvider):
    id: ClassVar[str] = "stub"
    tier: ClassVar[Literal["free", "paid"]] = "free"
    capabilities: ClassVar[set[Capability]] = {Capability.QUOTE}

    def __init__(self, prices: list[str]) -> None:
        self._prices = list(prices)

    async def get_quote(self, symbol: str) -> Quote:
        return _q(self._prices.pop(0) if self._prices else "100")


@pytest.mark.asyncio
async def test_poller_tick_once_emits_after_change() -> None:
    provider = _StubQuoter(["100", "105"])
    router = MarketDataRouter([provider], priority=["stub"])
    events: list[MarketAnomalyEvent] = []

    async def publisher(ev: MarketAnomalyEvent) -> None:
        events.append(ev)

    async def sources() -> list[str]:
        return ["SSE:600519"]

    poller = MarketPoller(
        router=router,
        symbols_source=sources,
        publisher=publisher,
        thresholds=PollerThresholds(sudden_spike_pct=Decimal("2.0")),
        symbol_name_map={"SSE:600519": "贵州茅台"},
    )
    first = await poller.tick_once()
    assert first == []  # no previous sample yet
    second = await poller.tick_once()
    assert len(second) == 1
    assert second[0].kind == "sudden_spike"
    assert second[0].symbol_name == "贵州茅台"
    assert second[0].severity == "P1"
    assert len(events) == 1


@pytest.mark.asyncio
async def test_poller_start_stop_idempotent() -> None:
    async def sources() -> list[str]:
        return []

    async def publisher(_: MarketAnomalyEvent) -> None:
        return None

    poller = MarketPoller(
        router=MarketDataRouter([], []),
        symbols_source=sources,
        publisher=publisher,
        interval_seconds=0.05,
    )
    await poller.start()
    assert poller.running
    await poller.start()  # noop
    await poller.stop()
    assert not poller.running
    await poller.stop()  # noop
