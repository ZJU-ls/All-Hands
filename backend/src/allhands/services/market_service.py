"""MarketService — spec § 6.1.

Wires the provider router, repos, and poller behind a single facade that
both REST + Meta Tools call. The poller is owned by this service so the
REST ``/api/market/poller/{start|stop|status}`` endpoints can drive it
without touching ``api/app.py`` lifespan wiring (Wave 2 strict-add rule).
"""

from __future__ import annotations

import io
import uuid
from csv import DictReader
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING, Any

from allhands.core.market import (
    Announcement,
    Bar,
    Holding,
    Interval,
    MarketAnomalyEvent,
    NewsItem,
    PollerThresholds,
    Quote,
    ScreenCriteria,
    Symbol,
    WatchedSymbol,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from allhands.execution.market.poller import MarketPoller
    from allhands.execution.market.router import MarketDataRouter
    from allhands.persistence.market_repos import (
        HoldingRepo,
        NewsRepo,
        SnapshotRepo,
        WatchedSymbolRepo,
    )

    AnomalyPublisher = Callable[[MarketAnomalyEvent], Awaitable[None]]


class HoldingNotFoundError(Exception):
    def __init__(self, symbol: str) -> None:
        super().__init__(f"Holding not found for {symbol}")
        self.symbol = symbol


def _parse_decimal(v: str | None) -> Decimal:
    if v is None or v.strip() == "":
        return Decimal(0)
    return Decimal(v)


class MarketService:
    def __init__(
        self,
        router: MarketDataRouter,
        watched_repo: WatchedSymbolRepo,
        holding_repo: HoldingRepo,
        snapshot_repo: SnapshotRepo,
        news_repo: NewsRepo,
        *,
        poller: MarketPoller | None = None,
        thresholds: PollerThresholds | None = None,
    ) -> None:
        self._router = router
        self._watched = watched_repo
        self._holdings = holding_repo
        self._snapshots = snapshot_repo
        self._news = news_repo
        self._poller = poller
        self._thresholds = thresholds or PollerThresholds()

    # -- quotes ---------------------------------------------------------

    async def get_quote(self, symbol: str) -> Quote:
        return await self._router.quote(symbol)

    async def get_quote_batch(self, symbols: list[str]) -> dict[str, Quote]:
        return await self._router.quote_batch(symbols)

    async def get_bars(
        self,
        symbol: str,
        interval: Interval,
        *,
        start: datetime | None = None,
        end: datetime | None = None,
    ) -> list[Bar]:
        end = end or datetime.now(UTC)
        start = start or (end - timedelta(days=30))
        cached = await self._snapshots.list_bars(symbol, interval, since=start, until=end)
        if cached:
            return cached
        bars = await self._router.bars(symbol, interval, start, end)
        if bars:
            await self._snapshots.save_bars(bars)
        return bars

    async def get_news(
        self,
        symbol: str | None = None,
        *,
        since: datetime | None = None,
        limit: int = 50,
    ) -> list[NewsItem]:
        since = since or datetime.now(UTC) - timedelta(days=1)
        cached = await self._news.list_for_symbol(symbol, since=since, limit=limit)
        if cached:
            return cached
        fresh = await self._router.news(symbol, since, limit=limit)
        if fresh:
            await self._news.save_many(fresh)
        return fresh

    async def get_announcements(
        self,
        symbol: str,
        *,
        since: datetime | None = None,
        limit: int = 50,
    ) -> list[Announcement]:
        since = since or datetime.now(UTC) - timedelta(days=7)
        return await self._router.announcements(symbol, since, limit=limit)

    async def search(self, query: str, *, limit: int = 10) -> list[Symbol]:
        return await self._router.search(query, limit=limit)

    async def screen(self, criteria: ScreenCriteria) -> list[Symbol]:
        return await self._router.screen(criteria)

    # -- watched --------------------------------------------------------

    async def list_watched(self) -> list[WatchedSymbol]:
        return await self._watched.list_all()

    async def add_watch(
        self,
        symbol: str,
        *,
        name: str,
        tag: str | None = None,
    ) -> WatchedSymbol:
        watched = WatchedSymbol(
            id=f"ws_{uuid.uuid4().hex[:16]}",
            symbol=symbol,
            name=name,
            tag=tag,
            added_at=datetime.now(UTC),
        )
        await self._watched.upsert(watched)
        return watched

    async def remove_watch(self, symbol: str) -> None:
        await self._watched.delete(symbol)

    # -- holdings -------------------------------------------------------

    async def list_holdings(self) -> list[Holding]:
        return await self._holdings.list_all()

    async def get_holding(self, symbol: str) -> Holding:
        holding = await self._holdings.get(symbol)
        if holding is None:
            raise HoldingNotFoundError(symbol)
        return holding

    async def add_holding(
        self,
        *,
        symbol: str,
        name: str,
        quantity: int,
        avg_cost: Decimal,
        opened_at: datetime | None = None,
        notes: str | None = None,
    ) -> Holding:
        holding = Holding(
            id=f"h_{uuid.uuid4().hex[:16]}",
            symbol=symbol,
            name=name,
            quantity=quantity,
            avg_cost=avg_cost,
            opened_at=opened_at,
            notes=notes,
        )
        await self._holdings.upsert(holding)
        return holding

    async def update_holding(
        self,
        symbol: str,
        *,
        quantity: int | None = None,
        avg_cost: Decimal | None = None,
        notes: str | None = None,
    ) -> Holding:
        current = await self.get_holding(symbol)
        updated = current.model_copy(
            update={
                "quantity": quantity if quantity is not None else current.quantity,
                "avg_cost": avg_cost if avg_cost is not None else current.avg_cost,
                "notes": notes if notes is not None else current.notes,
            }
        )
        await self._holdings.upsert(updated)
        return updated

    async def remove_holding(self, symbol: str) -> None:
        await self._holdings.delete(symbol)

    async def import_holdings_csv(self, content: bytes) -> list[Holding]:
        """CSV columns: symbol,name,quantity,avg_cost[,opened_at,notes].

        Replaces all holdings. Duplicates on symbol keep the first row.
        """
        text = content.decode("utf-8-sig")
        reader = DictReader(io.StringIO(text))
        holdings: list[Holding] = []
        seen: set[str] = set()
        for row in reader:
            symbol = (row.get("symbol") or "").strip()
            if not symbol or symbol in seen:
                continue
            seen.add(symbol)
            opened_raw = row.get("opened_at") or ""
            opened_at: datetime | None = None
            if opened_raw.strip():
                try:
                    opened_at = datetime.fromisoformat(opened_raw.strip())
                    if opened_at.tzinfo is None:
                        opened_at = opened_at.replace(tzinfo=UTC)
                except ValueError:
                    opened_at = None
            holdings.append(
                Holding(
                    id=f"h_{uuid.uuid4().hex[:16]}",
                    symbol=symbol,
                    name=(row.get("name") or symbol).strip(),
                    quantity=int(_parse_decimal(row.get("quantity"))),
                    avg_cost=_parse_decimal(row.get("avg_cost")),
                    opened_at=opened_at,
                    notes=(row.get("notes") or None) or None,
                )
            )
        return await self._holdings.replace_all(holdings)

    # -- poller ---------------------------------------------------------

    def attach_poller(self, poller: MarketPoller) -> None:
        self._poller = poller

    async def poller_status(self) -> dict[str, Any]:
        poller = self._poller
        if poller is None:
            return {
                "running": False,
                "last_tick_at": None,
                "thresholds": self._thresholds.model_dump(),
            }
        return {
            "running": poller.running,
            "last_tick_at": (poller.last_tick_at.isoformat() if poller.last_tick_at else None),
            "thresholds": self._thresholds.model_dump(),
        }

    async def poller_start(self) -> None:
        if self._poller is None:
            raise RuntimeError("poller not attached — call attach_poller() first")
        await self._poller.start()

    async def poller_stop(self) -> None:
        if self._poller is None:
            return
        await self._poller.stop()

    async def poller_tick_once(self) -> list[MarketAnomalyEvent]:
        if self._poller is None:
            raise RuntimeError("poller not attached")
        return await self._poller.tick_once()

    def set_thresholds(self, thresholds: PollerThresholds) -> None:
        self._thresholds = thresholds
        if self._poller is not None:
            self._poller.set_thresholds(thresholds)

    async def poll_symbols(self) -> list[str]:
        """Used by the poller to learn what to watch — watched union holdings."""
        watched = await self._watched.list_all()
        holdings = await self._holdings.list_all()
        symbols: dict[str, None] = {}
        for w in watched:
            symbols[w.symbol] = None
        for h in holdings:
            symbols[h.symbol] = None
        return list(symbols.keys())

    async def symbol_name_map(self) -> dict[str, str]:
        watched = await self._watched.list_all()
        holdings = await self._holdings.list_all()
        result: dict[str, str] = {}
        for w in watched:
            result[w.symbol] = w.name
        for h in holdings:
            result.setdefault(h.symbol, h.name)
        return result


__all__ = ["HoldingNotFoundError", "MarketService"]
