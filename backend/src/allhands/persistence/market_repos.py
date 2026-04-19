"""Market repo protocols + SQL implementations.

Isolated from ``sql_repos.py`` so the Wave 2 market-data feature lands as
pure additions.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Protocol

from sqlalchemy import delete, select

from allhands.core.market import (
    Bar,
    Holding,
    Interval,
    NewsItem,
    WatchedSymbol,
)
from allhands.persistence.orm.market_orm import (
    HoldingRow,
    MarketNewsRow,
    MarketSnapshotRow,
    WatchedSymbolRow,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt


def _naive(dt: datetime) -> datetime:
    return dt.replace(tzinfo=None)


def _row_to_watched(row: WatchedSymbolRow) -> WatchedSymbol:
    return WatchedSymbol(
        id=row.id,
        symbol=row.symbol,
        name=row.name,
        tag=row.tag,
        added_at=_utc(row.added_at),
    )


def _row_to_holding(row: HoldingRow) -> Holding:
    return Holding(
        id=row.id,
        symbol=row.symbol,
        name=row.name,
        quantity=row.quantity,
        avg_cost=row.avg_cost,
        opened_at=_utc(row.opened_at) if row.opened_at else None,
        notes=row.notes,
    )


def _row_to_bar(row: MarketSnapshotRow) -> Bar:
    return Bar(
        symbol=row.symbol,
        interval=row.interval,  # type: ignore[arg-type]
        open=row.open or Decimal(0),
        high=row.high or Decimal(0),
        low=row.low or Decimal(0),
        close=row.close or Decimal(0),
        volume=row.volume or 0,
        ts=_utc(row.ts),
    )


def _row_to_news(row: MarketNewsRow) -> NewsItem:
    return NewsItem(
        id=row.id,
        symbol=row.symbol,
        title=row.title,
        summary=row.summary or "",
        url=row.url,
        published_at=_utc(row.published_at),
        source=row.source,
        kind=row.kind,  # type: ignore[arg-type]
    )


class WatchedSymbolRepo(Protocol):
    async def list_all(self) -> list[WatchedSymbol]: ...
    async def upsert(self, watched: WatchedSymbol) -> WatchedSymbol: ...
    async def delete(self, symbol: str) -> None: ...


class HoldingRepo(Protocol):
    async def list_all(self) -> list[Holding]: ...
    async def get(self, symbol: str) -> Holding | None: ...
    async def upsert(self, holding: Holding) -> Holding: ...
    async def delete(self, symbol: str) -> None: ...
    async def replace_all(self, holdings: list[Holding]) -> list[Holding]: ...


class SnapshotRepo(Protocol):
    async def save_bars(self, bars: list[Bar]) -> None: ...
    async def list_bars(
        self,
        symbol: str,
        interval: Interval,
        *,
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int = 500,
    ) -> list[Bar]: ...


class NewsRepo(Protocol):
    async def save_many(self, items: list[NewsItem]) -> None: ...
    async def list_for_symbol(
        self,
        symbol: str | None,
        *,
        since: datetime | None = None,
        limit: int = 50,
    ) -> list[NewsItem]: ...


class SqlWatchedSymbolRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_all(self) -> list[WatchedSymbol]:
        result = await self._session.execute(
            select(WatchedSymbolRow).order_by(WatchedSymbolRow.added_at.desc())
        )
        return [_row_to_watched(r) for r in result.scalars().all()]

    async def upsert(self, watched: WatchedSymbol) -> WatchedSymbol:
        existing = await self._session.execute(
            select(WatchedSymbolRow).where(WatchedSymbolRow.symbol == watched.symbol)
        )
        row = existing.scalar_one_or_none()
        if row is None:
            self._session.add(
                WatchedSymbolRow(
                    id=watched.id,
                    symbol=watched.symbol,
                    name=watched.name,
                    tag=watched.tag,
                    added_at=_naive(watched.added_at),
                )
            )
        else:
            row.name = watched.name
            row.tag = watched.tag
        await self._session.flush()
        return watched

    async def delete(self, symbol: str) -> None:
        await self._session.execute(
            delete(WatchedSymbolRow).where(WatchedSymbolRow.symbol == symbol)
        )


class SqlHoldingRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_all(self) -> list[Holding]:
        result = await self._session.execute(select(HoldingRow).order_by(HoldingRow.symbol))
        return [_row_to_holding(r) for r in result.scalars().all()]

    async def get(self, symbol: str) -> Holding | None:
        result = await self._session.execute(select(HoldingRow).where(HoldingRow.symbol == symbol))
        row = result.scalar_one_or_none()
        return _row_to_holding(row) if row else None

    async def upsert(self, holding: Holding) -> Holding:
        result = await self._session.execute(
            select(HoldingRow).where(HoldingRow.symbol == holding.symbol)
        )
        row = result.scalar_one_or_none()
        if row is None:
            self._session.add(
                HoldingRow(
                    id=holding.id,
                    symbol=holding.symbol,
                    name=holding.name,
                    quantity=holding.quantity,
                    avg_cost=holding.avg_cost,
                    opened_at=_naive(holding.opened_at) if holding.opened_at else None,
                    notes=holding.notes,
                )
            )
        else:
            row.name = holding.name
            row.quantity = holding.quantity
            row.avg_cost = holding.avg_cost
            row.opened_at = _naive(holding.opened_at) if holding.opened_at else None
            row.notes = holding.notes
        await self._session.flush()
        return holding

    async def delete(self, symbol: str) -> None:
        await self._session.execute(delete(HoldingRow).where(HoldingRow.symbol == symbol))

    async def replace_all(self, holdings: list[Holding]) -> list[Holding]:
        await self._session.execute(delete(HoldingRow))
        for holding in holdings:
            await self.upsert(holding)
        return holdings


class SqlSnapshotRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def save_bars(self, bars: list[Bar]) -> None:
        for bar in bars:
            existing = await self._session.execute(
                select(MarketSnapshotRow).where(
                    MarketSnapshotRow.symbol == bar.symbol,
                    MarketSnapshotRow.interval == bar.interval,
                    MarketSnapshotRow.ts == _naive(bar.ts),
                )
            )
            row = existing.scalar_one_or_none()
            if row is None:
                self._session.add(
                    MarketSnapshotRow(
                        symbol=bar.symbol,
                        interval=bar.interval,
                        ts=_naive(bar.ts),
                        open=bar.open,
                        high=bar.high,
                        low=bar.low,
                        close=bar.close,
                        volume=bar.volume,
                    )
                )
            else:
                row.open = bar.open
                row.high = bar.high
                row.low = bar.low
                row.close = bar.close
                row.volume = bar.volume
        await self._session.flush()

    async def list_bars(
        self,
        symbol: str,
        interval: Interval,
        *,
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int = 500,
    ) -> list[Bar]:
        stmt = (
            select(MarketSnapshotRow)
            .where(
                MarketSnapshotRow.symbol == symbol,
                MarketSnapshotRow.interval == interval,
            )
            .order_by(MarketSnapshotRow.ts.asc())
            .limit(limit)
        )
        if since is not None:
            stmt = stmt.where(MarketSnapshotRow.ts >= _naive(since))
        if until is not None:
            stmt = stmt.where(MarketSnapshotRow.ts <= _naive(until))
        result = await self._session.execute(stmt)
        return [_row_to_bar(r) for r in result.scalars().all()]


class SqlNewsRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def save_many(self, items: list[NewsItem]) -> None:
        for item in items:
            existing = await self._session.get(MarketNewsRow, item.id)
            if existing is not None:
                continue
            self._session.add(
                MarketNewsRow(
                    id=item.id,
                    symbol=item.symbol,
                    title=item.title,
                    summary=item.summary or None,
                    url=item.url,
                    published_at=_naive(item.published_at),
                    source=item.source,
                    fetched_at=_naive(datetime.now(UTC)),
                    kind=item.kind,
                )
            )
        await self._session.flush()

    async def list_for_symbol(
        self,
        symbol: str | None,
        *,
        since: datetime | None = None,
        limit: int = 50,
    ) -> list[NewsItem]:
        stmt = select(MarketNewsRow).order_by(MarketNewsRow.published_at.desc()).limit(limit)
        if symbol is not None:
            stmt = stmt.where(MarketNewsRow.symbol == symbol)
        if since is not None:
            stmt = stmt.where(MarketNewsRow.published_at >= _naive(since))
        result = await self._session.execute(stmt)
        return [_row_to_news(r) for r in result.scalars().all()]


__all__ = [
    "HoldingRepo",
    "NewsRepo",
    "SnapshotRepo",
    "SqlHoldingRepo",
    "SqlNewsRepo",
    "SqlSnapshotRepo",
    "SqlWatchedSymbolRepo",
    "WatchedSymbolRepo",
]
