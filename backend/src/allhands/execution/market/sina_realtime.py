"""Sina non-official realtime quote adapter (spec § 4.2).

The free ``hq.sinajs.cn`` endpoint returns semicolon-separated text with the
live snapshot. v0 covers A-share (SSE/SZSE); other markets raise
``ProviderNotSupported`` so the router falls through.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, ClassVar, Literal

import httpx

from allhands.core.market import Quote
from allhands.execution.market.base import (
    Capability,
    MarketDataProvider,
    ProviderError,
    ProviderNotSupported,
    TransientError,
)

_SINA_BASE = "https://hq.sinajs.cn/list="


def _to_sina_code(full_code: str) -> str:
    """``SSE:600519`` -> ``sh600519``, ``SZSE:000001`` -> ``sz000001``."""
    if ":" not in full_code:
        raise ProviderNotSupported(f"unrecognized symbol: {full_code}")
    exchange, code = full_code.split(":", 1)
    if exchange == "SSE":
        return f"sh{code}"
    if exchange == "SZSE":
        return f"sz{code}"
    raise ProviderNotSupported(f"sina_realtime unsupported exchange: {exchange}")


class SinaRealtimeProvider(MarketDataProvider):
    id: ClassVar[str] = "sina_realtime"
    tier: ClassVar[Literal["free", "paid"]] = "free"
    capabilities: ClassVar[set[Capability]] = {Capability.QUOTE}

    http_factory: Any = None

    def _client(self) -> httpx.AsyncClient:
        if self.http_factory is not None:
            return self.http_factory()  # type: ignore[no-any-return]
        return httpx.AsyncClient(
            timeout=3.0,
            headers={"Referer": "https://finance.sina.com.cn"},
        )

    async def get_quote(self, symbol: str) -> Quote:
        sina_code = _to_sina_code(symbol)
        url = f"{_SINA_BASE}{sina_code}"
        try:
            async with self._client() as client:
                resp = await client.get(url)
        except httpx.HTTPError as exc:
            raise TransientError(str(exc)) from exc
        if resp.status_code >= 400:
            raise TransientError(f"sina http {resp.status_code}")
        text = resp.text
        # `var hq_str_sh600519="贵州茅台,1680.00,1700.00,1720.00,...,2026-04-19,15:00:00";`
        _, _, body = text.partition('="')
        body = body.rstrip(";\n").rstrip('"')
        fields = body.split(",")
        if len(fields) < 32:
            raise ProviderError(f"sina unexpected payload shape ({len(fields)} fields)")
        try:
            prev_close = Decimal(fields[2])
            last = Decimal(fields[3])
            open_p = Decimal(fields[1])
            high = Decimal(fields[4])
            low = Decimal(fields[5])
            volume = int(float(fields[8])) if fields[8] else 0
            turnover = Decimal(fields[9]) if fields[9] else Decimal(0)
        except (ValueError, ArithmeticError) as exc:
            raise ProviderError(f"sina parse failure: {exc!s}") from exc
        change = last - prev_close
        change_pct = (change / prev_close) * Decimal(100) if prev_close else Decimal(0)
        return Quote(
            symbol=symbol,
            last=last,
            change=change.quantize(Decimal("0.0001")),
            change_pct=change_pct.quantize(Decimal("0.01")),
            open=open_p,
            high=high,
            low=low,
            prev_close=prev_close,
            volume=volume,
            turnover=turnover,
            ts=datetime.now(UTC),
            source=self.id,
        )


__all__ = ["SinaRealtimeProvider"]
