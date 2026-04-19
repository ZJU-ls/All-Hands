"""baostock provider (spec § 4.2) — free historical bar backfill.

baostock ships a sync API; we wrap every call in ``asyncio.to_thread``. If
baostock isn't installed we raise ``ProviderNotSupported`` so the router
silently falls through to the next provider (akshare).
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, ClassVar, Literal

from allhands.core.market import Bar, Interval
from allhands.execution.market.base import (
    Capability,
    MarketDataProvider,
    ProviderError,
    ProviderNotSupported,
)


def _load_baostock() -> Any:  # pragma: no cover — real import path
    try:
        import baostock as bs  # type: ignore[import-not-found,unused-ignore]
    except ImportError as exc:
        raise ProviderNotSupported(
            "baostock package not installed; run `uv pip install baostock` to enable"
        ) from exc
    return bs


class BaoStockProvider(MarketDataProvider):
    id: ClassVar[str] = "baostock"
    tier: ClassVar[Literal["free", "paid"]] = "free"
    capabilities: ClassVar[set[Capability]] = {Capability.BARS}

    baostock_module: Any = None  # tests inject a fake

    def _bs(self) -> Any:
        if self.baostock_module is not None:
            return self.baostock_module
        return _load_baostock()

    async def get_bars(
        self,
        symbol: str,
        interval: Interval,
        start: datetime,
        end: datetime,
    ) -> list[Bar]:
        bs = self._bs()
        _, _, code = symbol.partition(":")

        def _fetch() -> list[dict[str, str]]:
            bs.login()
            try:
                rs = bs.query_history_k_data_plus(
                    _bao_code(symbol, code),
                    "date,open,high,low,close,volume",
                    start_date=start.strftime("%Y-%m-%d"),
                    end_date=end.strftime("%Y-%m-%d"),
                    frequency=_bao_freq(interval),
                    adjustflag="3",
                )
                rows: list[dict[str, str]] = []
                while rs.next():
                    rows.append(dict(zip(rs.fields, rs.get_row_data(), strict=False)))
                return rows
            finally:
                bs.logout()

        try:
            records = await asyncio.to_thread(_fetch)
        except ProviderError:
            raise
        except Exception as exc:  # pragma: no cover
            raise ProviderError(f"baostock get_bars failed: {exc!s}") from exc
        bars: list[Bar] = []
        for r in records:
            try:
                ts = datetime.strptime(r["date"], "%Y-%m-%d").replace(tzinfo=UTC)
                bars.append(
                    Bar(
                        symbol=symbol,
                        interval=interval,
                        open=Decimal(r["open"]),
                        high=Decimal(r["high"]),
                        low=Decimal(r["low"]),
                        close=Decimal(r["close"]),
                        volume=int(r.get("volume", 0) or 0),
                        ts=ts,
                    )
                )
            except (ValueError, KeyError):
                continue
        return bars


def _bao_code(full: str, code: str) -> str:
    exchange, _, _ = full.partition(":")
    if exchange == "SSE":
        return f"sh.{code}"
    return f"sz.{code}"


def _bao_freq(interval: Interval) -> str:
    return {
        "1m": "5",  # baostock min resolution is 5-min for free tier
        "5m": "5",
        "15m": "15",
        "30m": "30",
        "1h": "60",
        "1d": "d",
    }.get(interval, "d")


__all__ = ["BaoStockProvider"]
