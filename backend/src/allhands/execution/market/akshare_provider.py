"""akshare provider (spec § 4.2).

akshare is heavy (pandas-based, sync) and not in default deps. This adapter
imports it lazily so the project runs without akshare installed; capabilities
that need it raise ``ProviderNotSupported`` until the package is available.

v0 concentrates on quote + news + announcements surface; bars delegate to
baostock for free historical depth.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any, ClassVar, Literal

from allhands.core.market import (
    Announcement,
    Bar,
    Exchange,
    Interval,
    NewsItem,
    Quote,
    ScreenCriteria,
    Symbol,
)
from allhands.execution.market.base import (
    Capability,
    MarketDataProvider,
    ProviderError,
    ProviderNotSupported,
)


def _load_akshare() -> Any:  # pragma: no cover — real import path
    try:
        import akshare  # type: ignore[import-not-found,unused-ignore]
    except ImportError as exc:
        raise ProviderNotSupported(
            "akshare package not installed; run `uv pip install akshare` to enable this provider"
        ) from exc
    return akshare


def _exchange_for(symbol_code: str) -> Exchange:
    if symbol_code.startswith(("60", "68")):
        return Exchange.SSE
    if symbol_code.startswith(("00", "30")):
        return Exchange.SZSE
    if symbol_code.startswith(("8", "43", "4")):
        return Exchange.BSE
    return Exchange.SSE


class AkshareProvider(MarketDataProvider):
    id: ClassVar[str] = "akshare"
    tier: ClassVar[Literal["free", "paid"]] = "free"
    capabilities: ClassVar[set[Capability]] = {
        Capability.QUOTE,
        Capability.BARS,
        Capability.NEWS,
        Capability.ANNOUNCEMENTS,
        Capability.SEARCH,
        Capability.SCREEN,
    }

    # tests can inject a fake akshare module
    akshare_module: Any = None

    def _ak(self) -> Any:
        if self.akshare_module is not None:
            return self.akshare_module
        return _load_akshare()

    async def get_quote(self, symbol: str) -> Quote:
        ak = self._ak()
        _, _, code = symbol.partition(":")

        def _fetch() -> dict[str, Any]:
            # akshare's stock_bid_ask_em returns a DataFrame; we extract level-1.
            df = ak.stock_bid_ask_em(symbol=code)
            rows = df.to_dict("records")
            if not rows:
                raise ProviderError(f"akshare returned empty quote for {symbol}")
            return rows[0]  # type: ignore[no-any-return]

        try:
            record = await asyncio.to_thread(_fetch)
        except ProviderError:
            raise
        except Exception as exc:  # pragma: no cover — defensive
            raise ProviderError(f"akshare get_quote failed: {exc!s}") from exc
        last = Decimal(str(record.get("最新", record.get("last", 0))))
        prev = Decimal(str(record.get("昨收", record.get("prev_close", last))))
        change = last - prev
        change_pct = (change / prev * Decimal(100)) if prev else Decimal(0)
        return Quote(
            symbol=symbol,
            last=last,
            change=change,
            change_pct=change_pct,
            prev_close=prev,
            ts=datetime.now(UTC),
            source=self.id,
        )

    async def get_news(
        self,
        symbol: str | None,
        since: datetime,
        *,
        limit: int = 50,
    ) -> list[NewsItem]:
        ak = self._ak()

        def _fetch() -> list[dict[str, Any]]:
            if symbol is None:
                df = ak.stock_news_em()
            else:
                _, _, code = symbol.partition(":")
                df = ak.stock_news_em(symbol=code)
            return df.head(limit).to_dict("records")  # type: ignore[no-any-return]

        try:
            records = await asyncio.to_thread(_fetch)
        except Exception as exc:  # pragma: no cover — defensive
            raise ProviderError(f"akshare get_news failed: {exc!s}") from exc
        items: list[NewsItem] = []
        for r in records:
            published_raw = r.get("发布时间") or r.get("published_at")
            try:
                published_at = datetime.fromisoformat(str(published_raw))
            except ValueError:
                published_at = datetime.now(UTC)
            if published_at < since.replace(tzinfo=None):
                continue
            items.append(
                NewsItem(
                    id=uuid.uuid5(
                        uuid.NAMESPACE_URL,
                        str(r.get("新闻链接", r.get("url", published_raw))),
                    ).hex,
                    symbol=symbol,
                    title=str(r.get("新闻标题", r.get("title", ""))),
                    summary=str(r.get("新闻内容", r.get("summary", "")))[:1000],
                    url=str(r.get("新闻链接", r.get("url", ""))),
                    published_at=published_at.replace(tzinfo=UTC)
                    if published_at.tzinfo is None
                    else published_at,
                    source=str(r.get("文章来源", "akshare")),
                    kind="news",
                )
            )
        return items

    async def get_announcements(
        self,
        symbol: str,
        since: datetime,
        *,
        limit: int = 50,
    ) -> list[Announcement]:
        # v0: map news with kind=announcement when akshare reports one.
        news = await self.get_news(symbol, since, limit=limit)
        announcements: list[Announcement] = []
        for n in news:
            if "公告" in n.title or "announcement" in n.source.lower():
                announcements.append(
                    Announcement(
                        id=n.id,
                        symbol=symbol,
                        title=n.title,
                        kind="其他",
                        url=n.url,
                        published_at=n.published_at,
                        summary=n.summary,
                    )
                )
        return announcements[:limit]

    async def search_symbol(self, query: str, *, limit: int = 10) -> list[Symbol]:
        ak = self._ak()

        def _fetch() -> list[dict[str, Any]]:
            df = ak.stock_info_a_code_name()
            records = df.to_dict("records")
            filtered: list[dict[str, Any]] = []
            for r in records:
                code = str(r.get("code", ""))
                name = str(r.get("name", ""))
                if query in code or query in name:
                    filtered.append({"code": code, "name": name})
                if len(filtered) >= limit:
                    break
            return filtered

        try:
            records = await asyncio.to_thread(_fetch)
        except Exception as exc:  # pragma: no cover
            raise ProviderError(f"akshare search failed: {exc!s}") from exc
        return [
            Symbol(code=r["code"], exchange=_exchange_for(r["code"]), name=r["name"])
            for r in records
        ]

    async def screen(self, criteria: ScreenCriteria) -> list[Symbol]:
        # v0: return empty — screen is an opinionated projection and akshare
        # does not ship a ready-made endpoint that matches ScreenCriteria.
        # The stock-assistant spec's `screen_by_logic` tool composes its own
        # queries and falls back to search_symbol + tag filter.
        del criteria
        return []

    async def get_bars(
        self,
        symbol: str,
        interval: Interval,
        start: datetime,
        end: datetime,
    ) -> list[Bar]:
        ak = self._ak()
        _, _, code = symbol.partition(":")

        def _fetch() -> list[dict[str, Any]]:
            if interval == "1d":
                df = ak.stock_zh_a_hist(
                    symbol=code,
                    period="daily",
                    start_date=start.strftime("%Y%m%d"),
                    end_date=end.strftime("%Y%m%d"),
                )
            else:
                df = ak.stock_zh_a_minute(
                    symbol=f"{_sina_prefix(code)}{code}",
                    period=_interval_minutes(interval),
                )
            return df.to_dict("records")  # type: ignore[no-any-return]

        try:
            records = await asyncio.to_thread(_fetch)
        except Exception as exc:  # pragma: no cover
            raise ProviderError(f"akshare get_bars failed: {exc!s}") from exc
        bars: list[Bar] = []
        for r in records:
            ts_raw = r.get("日期") or r.get("时间") or r.get("ts")
            try:
                ts = datetime.fromisoformat(str(ts_raw))
            except ValueError:
                continue
            bars.append(
                Bar(
                    symbol=symbol,
                    interval=interval,
                    open=Decimal(str(r.get("开盘", r.get("open", 0)))),
                    high=Decimal(str(r.get("最高", r.get("high", 0)))),
                    low=Decimal(str(r.get("最低", r.get("low", 0)))),
                    close=Decimal(str(r.get("收盘", r.get("close", 0)))),
                    volume=int(r.get("成交量", r.get("volume", 0)) or 0),
                    ts=ts.replace(tzinfo=UTC) if ts.tzinfo is None else ts,
                )
            )
        return bars


def _sina_prefix(code: str) -> str:
    exchange = _exchange_for(code)
    return "sh" if exchange == Exchange.SSE else "sz"


def _interval_minutes(interval: Interval) -> str:
    return {
        "1m": "1",
        "5m": "5",
        "15m": "15",
        "30m": "30",
        "1h": "60",
    }.get(interval, "5")


# Ensure ``timedelta`` import is retained for future caching logic
_ = timedelta

__all__ = ["AkshareProvider"]
