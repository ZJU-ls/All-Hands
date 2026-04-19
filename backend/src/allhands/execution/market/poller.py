"""market-ticker-poller (spec § 5).

Runs as an asyncio task: polls ``watched_symbols`` union ``holdings`` every
``interval`` seconds, detects anomalies, emits ``MarketAnomalyEvent`` to an
event publisher. The publisher is an async callable so the poller never
imports a concrete EventBus; tests pass a list-appender.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import statistics
from datetime import UTC, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from allhands.core.market import (
    AnomalyKind,
    MarketAnomalyEvent,
    PollerThresholds,
    Quote,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from allhands.execution.market.router import MarketDataRouter

    SymbolsSource = Callable[[], Awaitable[list[str]]]
    AnomalyPublisher = Callable[[MarketAnomalyEvent], Awaitable[None]]

logger = logging.getLogger(__name__)


def _severity_for(kind: AnomalyKind) -> str:
    return {
        "sudden_spike": "P1",
        "sudden_drop": "P1",
        "crash": "P0",
        "limit_up": "P2",
        "volume_spike": "P2",
    }[kind]


def detect_anomaly(
    prev: Quote,
    current: Quote,
    thresholds: PollerThresholds,
    *,
    recent_volumes: list[int] | None = None,
) -> AnomalyKind | None:
    """Pure function — given two quotes, return the anomaly kind or None.

    Priority: crash/limit_up > sudden_drop/spike > volume_spike.
    """
    if prev.last == 0:
        return None
    change_pct = (current.last - prev.last) / prev.last * Decimal(100)
    if change_pct <= thresholds.crash_pct:
        return "crash"
    if change_pct >= thresholds.limit_up_pct:
        return "limit_up"
    if change_pct >= thresholds.sudden_spike_pct:
        return "sudden_spike"
    if change_pct <= thresholds.sudden_drop_pct:
        return "sudden_drop"
    if recent_volumes and current.volume is not None and len(recent_volumes) >= 5:
        mean = statistics.mean(recent_volumes)
        stdev = statistics.stdev(recent_volumes) if len(recent_volumes) > 1 else 0
        if stdev > 0 and current.volume > mean + float(thresholds.volume_spike_sigma) * stdev:
            return "volume_spike"
    return None


class MarketPoller:
    """Background poller with explicit start/stop."""

    def __init__(
        self,
        router: MarketDataRouter,
        symbols_source: SymbolsSource,
        publisher: AnomalyPublisher,
        *,
        thresholds: PollerThresholds | None = None,
        interval_seconds: float = 3.0,
        symbol_name_map: dict[str, str] | None = None,
    ) -> None:
        self._router = router
        self._symbols_source = symbols_source
        self._publisher = publisher
        self._thresholds = thresholds or PollerThresholds()
        self._interval = interval_seconds
        self._last_quote: dict[str, Quote] = {}
        self._volume_history: dict[str, list[int]] = {}
        self._task: asyncio.Task[None] | None = None
        self._stopping = False
        self._name_map = dict(symbol_name_map or {})

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    @property
    def last_tick_at(self) -> datetime | None:
        if not self._last_quote:
            return None
        return max(q.ts for q in self._last_quote.values())

    def set_thresholds(self, thresholds: PollerThresholds) -> None:
        self._thresholds = thresholds

    async def start(self) -> None:
        if self.running:
            return
        self._stopping = False
        self._task = asyncio.create_task(self._loop(), name="market-ticker-poller")
        logger.info("market.poller.started", extra={"interval_s": self._interval})

    async def stop(self) -> None:
        self._stopping = True
        if self._task is None:
            return
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        self._task = None
        logger.info("market.poller.stopped")

    async def tick_once(self) -> list[MarketAnomalyEvent]:
        """Run one pass synchronously — handy for tests + manual debugging.

        Returns the anomaly events that were published this pass.
        """
        symbols = await self._symbols_source()
        events: list[MarketAnomalyEvent] = []
        for symbol in symbols:
            ev = await self._tick_one(symbol)
            if ev is not None:
                events.append(ev)
        return events

    async def _loop(self) -> None:
        while not self._stopping:
            try:
                await self.tick_once()
            except Exception:  # pragma: no cover — defensive
                logger.exception("market.poller.tick_failed")
            await asyncio.sleep(self._interval)

    async def _tick_one(self, symbol: str) -> MarketAnomalyEvent | None:
        from allhands.execution.market.router import NoProviderAvailableError

        try:
            quote = await self._router.quote(symbol)
        except NoProviderAvailableError:
            return None
        prev = self._last_quote.get(symbol)
        self._last_quote[symbol] = quote
        if quote.volume is not None:
            self._volume_history.setdefault(symbol, []).append(quote.volume)
            self._volume_history[symbol] = self._volume_history[symbol][-30:]
        if prev is None:
            return None
        anomaly = detect_anomaly(
            prev,
            quote,
            self._thresholds,
            recent_volumes=self._volume_history.get(symbol),
        )
        if anomaly is None:
            return None
        change_pct = (
            (quote.last - prev.last) / prev.last * Decimal(100) if prev.last else Decimal(0)
        )
        event = MarketAnomalyEvent(
            symbol=symbol,
            symbol_name=self._name_map.get(symbol, ""),
            kind=anomaly,
            from_price=prev.last,
            to_price=quote.last,
            change_pct=change_pct,
            window_s=int(self._interval),
            severity=_severity_for(anomaly),  # type: ignore[arg-type]
            detected_at=datetime.now(UTC),
        )
        await self._publisher(event)
        return event


__all__ = ["MarketPoller", "detect_anomaly"]
