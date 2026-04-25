"""Closed loop: market-ticker-poller → publisher → events table → trigger.

Spec § 12 calls for a test proving an anomaly observed by the poller lands on
the events bus so triggers can react. Here we plumb the publisher to write an
``EventEnvelope`` into the events repo and assert the row shape.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import ClassVar, Literal

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from allhands.core import EventEnvelope
from allhands.core.market import MarketAnomalyEvent, PollerThresholds, Quote
from allhands.execution.market.base import Capability, MarketDataProvider
from allhands.execution.market.poller import MarketPoller
from allhands.execution.market.router import MarketDataRouter
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlEventRepo


class _StepProvider(MarketDataProvider):
    id: ClassVar[str] = "step"
    tier: ClassVar[Literal["free", "paid"]] = "free"
    capabilities: ClassVar[set[Capability]] = {Capability.QUOTE}

    def __init__(self, prices: list[str]) -> None:
        self._prices = list(prices)

    async def get_quote(self, symbol: str) -> Quote:
        p = self._prices.pop(0) if self._prices else "100"
        return Quote(
            symbol=symbol,
            last=Decimal(p),
            ts=datetime.now(UTC),
            source=self.id,
        )


@pytest.mark.asyncio
async def test_anomaly_lands_in_events_table() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async def _publisher(ev: MarketAnomalyEvent) -> None:
        async with maker() as session:
            envelope = EventEnvelope(
                id=f"evt_{uuid.uuid4().hex[:16]}",
                kind="market.anomaly",
                payload=ev.model_dump(mode="json"),
                published_at=datetime.now(UTC),
                severity=ev.severity,
                subject=ev.symbol,
                workspace_id="default",
            )
            await SqlEventRepo(session).save(envelope)

    router = MarketDataRouter([_StepProvider(["100", "103"])], priority=["step"])

    async def _sources() -> list[str]:
        return ["SSE:600519"]

    poller = MarketPoller(
        router=router,
        symbols_source=_sources,
        publisher=_publisher,
        thresholds=PollerThresholds(sudden_spike_pct=Decimal("2.0")),
    )
    await poller.tick_once()  # seed
    events = await poller.tick_once()  # triggers anomaly
    assert len(events) == 1
    assert events[0].kind == "sudden_spike"

    async with maker() as session:
        recent = await SqlEventRepo(session).list_recent(limit=10)
    anomalies = [e for e in recent if e.kind == "market.anomaly"]
    assert len(anomalies) == 1
    assert anomalies[0].payload["symbol"] == "SSE:600519"
    assert anomalies[0].severity == "P1"
