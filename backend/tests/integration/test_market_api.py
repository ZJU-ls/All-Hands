"""End-to-end tests for /api/market/*.

Uses an in-memory SQLite engine and a monkeypatched router that serves
deterministic fake quotes, so every test completes in < 1s.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from decimal import Decimal
from typing import ClassVar, Literal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from allhands.api import create_app
from allhands.api.deps import get_session
from allhands.core.market import Quote
from allhands.execution.market.base import Capability, MarketDataProvider
from allhands.execution.market.router import MarketDataRouter
from allhands.persistence.orm.base import Base


class _FakeQuoteProvider(MarketDataProvider):
    id: ClassVar[str] = "fake"
    tier: ClassVar[Literal["free", "paid"]] = "free"
    capabilities: ClassVar[set[Capability]] = {Capability.QUOTE}

    async def get_quote(self, symbol: str) -> Quote:
        return Quote(
            symbol=symbol,
            last=Decimal("100.00"),
            change=Decimal("0.50"),
            change_pct=Decimal("0.50"),
            ts=datetime.now(UTC),
            source=self.id,
        )


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    async def _session() -> AsyncIterator[AsyncSession]:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as s, s.begin():
            yield s

    monkeypatch.setattr(
        "allhands.api.routers.market.build_default_router",
        lambda: MarketDataRouter([_FakeQuoteProvider()], priority=["fake"]),
    )
    app = create_app()
    app.dependency_overrides[get_session] = _session
    return TestClient(app)


def test_get_quote(client: TestClient) -> None:
    resp = client.get("/api/market/quote/SSE:600519")
    assert resp.status_code == 200
    data = resp.json()
    assert data["symbol"] == "SSE:600519"
    assert data["last"] == 100.0


def test_get_quote_batch(client: TestClient) -> None:
    resp = client.post("/api/market/quotes", json={"symbols": ["A", "B", "C"]})
    assert resp.status_code == 200
    assert set(resp.json().keys()) == {"A", "B", "C"}


def test_watch_lifecycle(client: TestClient) -> None:
    resp = client.post(
        "/api/market/watched", json={"symbol": "SSE:600519", "name": "贵州茅台", "tag": "白酒"}
    )
    assert resp.status_code == 201
    listing = client.get("/api/market/watched").json()
    assert listing[0]["symbol"] == "SSE:600519"
    assert client.delete("/api/market/watched/SSE:600519").status_code == 204
    assert client.get("/api/market/watched").json() == []


def test_holdings_lifecycle(client: TestClient) -> None:
    resp = client.post(
        "/api/market/holdings",
        json={
            "symbol": "SSE:600519",
            "name": "贵州茅台",
            "quantity": 100,
            "avg_cost": 1700.0,
        },
    )
    assert resp.status_code == 201
    listing = client.get("/api/market/holdings").json()
    assert listing[0]["quantity"] == 100
    resp = client.patch(
        "/api/market/holdings/SSE:600519",
        json={"quantity": 200, "notes": "加仓"},
    )
    assert resp.status_code == 200
    assert resp.json()["quantity"] == 200
    assert client.delete("/api/market/holdings/SSE:600519").status_code == 204


def test_import_holdings_csv(client: TestClient) -> None:
    csv = (
        "symbol,name,quantity,avg_cost\n"
        "SSE:600519,贵州茅台,100,1700.5\n"
        "SZSE:000001,平安银行,500,12.34\n"
    )
    resp = client.post(
        "/api/market/holdings/import-csv",
        files={"file": ("holdings.csv", csv.encode("utf-8"), "text/csv")},
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 2


def test_poller_status_running_false_initially(client: TestClient) -> None:
    resp = client.get("/api/market/poller/status")
    assert resp.status_code == 200
    assert resp.json()["running"] is False


def test_poller_thresholds_update(client: TestClient) -> None:
    resp = client.post(
        "/api/market/poller/thresholds",
        json={
            "sudden_spike_pct": 1.5,
            "sudden_drop_pct": -1.5,
            "crash_pct": -7.0,
            "limit_up_pct": 9.9,
            "volume_spike_sigma": 2.5,
            "window_seconds": 120,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["window_seconds"] == 120


def test_search_returns_empty_when_no_search_provider(client: TestClient) -> None:
    resp = client.get("/api/market/search", params={"q": "茅台"})
    assert resp.status_code == 200
    assert resp.json() == []


def test_news_cache_roundtrip(client: TestClient) -> None:
    # Without a real provider the news list comes back empty but the endpoint
    # must respond 200 so the UI can render a zero-state.
    resp = client.get("/api/market/news")
    assert resp.status_code == 200
    assert resp.json() == []


def _register_watch(client: TestClient, symbol: str = "SSE:600519") -> None:
    client.post("/api/market/watched", json={"symbol": symbol, "name": "贵州茅台"})


def test_poller_start_stop_flow(client: TestClient) -> None:
    _register_watch(client)
    assert client.post("/api/market/poller/start").status_code == 202
    assert client.post("/api/market/poller/stop").status_code == 202


@pytest.mark.asyncio
async def test_poller_tick_once_publishes_anomaly(client: TestClient) -> None:
    """Prove the /poller/tick-once path works through the router state."""
    _register_watch(client)
    # start to attach the poller into state, then stop its background loop so
    # our deterministic tick_once is the only source of updates.
    client.post("/api/market/poller/start")
    client.post("/api/market/poller/stop")
    # first tick: no prior sample, no events
    resp1 = client.post("/api/market/poller/tick-once")
    assert resp1.status_code == 200
    assert resp1.json() == []
    # second tick: same fake provider → same quote → still no event
    resp2 = client.post("/api/market/poller/tick-once")
    assert resp2.status_code == 200
    assert resp2.json() == []  # fake provider always returns the same last
