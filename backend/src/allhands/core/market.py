"""Market domain model — quotes / bars / news / announcements (spec § 3.1).

Core is framework-free (pydantic only). All numeric money values use
``Decimal`` so the gateway between providers (who sometimes return strings,
sometimes floats) is lossless.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class Exchange(StrEnum):
    SSE = "SSE"
    SZSE = "SZSE"
    BSE = "BSE"
    HKEX = "HKEX"  # v1 placeholder
    US = "US"  # v1 placeholder


Interval = Literal["1m", "5m", "15m", "30m", "1h", "1d"]
NewsKind = Literal["news", "announcement"]
AnomalyKind = Literal["sudden_spike", "sudden_drop", "crash", "limit_up", "volume_spike"]


class Symbol(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    exchange: Exchange
    name: str = Field(min_length=1, max_length=128)

    model_config = {"frozen": True}

    @property
    def full_code(self) -> str:
        return f"{self.exchange.value}:{self.code}"


class Quote(BaseModel):
    symbol: str = Field(min_length=1, max_length=32)
    last: Decimal
    change: Decimal = Decimal(0)
    change_pct: Decimal = Decimal(0)
    open: Decimal | None = None
    high: Decimal | None = None
    low: Decimal | None = None
    prev_close: Decimal | None = None
    volume: int | None = None
    turnover: Decimal | None = None
    bid: list[tuple[Decimal, int]] = Field(default_factory=list)
    ask: list[tuple[Decimal, int]] = Field(default_factory=list)
    ts: datetime
    source: str = Field(min_length=1, max_length=32)

    model_config = {"frozen": True}


class Bar(BaseModel):
    symbol: str
    interval: Interval
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int = 0
    ts: datetime

    model_config = {"frozen": True}


class NewsItem(BaseModel):
    id: str
    symbol: str | None = None
    title: str
    summary: str = ""
    url: str
    published_at: datetime
    source: str
    kind: NewsKind = "news"

    model_config = {"frozen": True}


class Announcement(BaseModel):
    id: str
    symbol: str
    title: str
    kind: Literal["财报", "分红", "重大事项", "停复牌", "其他"] = "其他"
    url: str
    published_at: datetime
    summary: str | None = None

    model_config = {"frozen": True}


class WatchedSymbol(BaseModel):
    id: str
    symbol: str
    name: str
    tag: str | None = None
    added_at: datetime

    model_config = {"frozen": True}


class Holding(BaseModel):
    id: str
    symbol: str
    name: str
    quantity: int = Field(ge=0)
    avg_cost: Decimal
    opened_at: datetime | None = None
    notes: str | None = None

    model_config = {"frozen": True}


class ScreenCriteria(BaseModel):
    """Free-form screener input — providers narrow to what they support."""

    pe_lt: Decimal | None = None
    pe_gt: Decimal | None = None
    pb_lt: Decimal | None = None
    turnover_mean_lt: Decimal | None = None
    revenue_yoy_gt: Decimal | None = None
    tags: list[str] = Field(default_factory=list)
    limit: int = Field(default=50, ge=1, le=500)

    model_config = {"frozen": True}


class PollerThresholds(BaseModel):
    sudden_spike_pct: Decimal = Decimal("2.0")
    sudden_drop_pct: Decimal = Decimal("-2.0")
    crash_pct: Decimal = Decimal("-8.0")
    limit_up_pct: Decimal = Decimal("10.0")
    volume_spike_sigma: Decimal = Decimal("3.0")
    window_seconds: int = 60

    model_config = {"frozen": True}


class MarketAnomalyEvent(BaseModel):
    """Payload written to ``events(type='market.anomaly')``."""

    symbol: str
    symbol_name: str = ""
    kind: AnomalyKind
    from_price: Decimal
    to_price: Decimal
    change_pct: Decimal
    window_s: int
    severity: Literal["info", "warn", "P2", "P1", "P0"] = "P1"
    detected_at: datetime

    model_config = {"frozen": True}


__all__ = [
    "Announcement",
    "AnomalyKind",
    "Bar",
    "Exchange",
    "Holding",
    "Interval",
    "MarketAnomalyEvent",
    "NewsItem",
    "NewsKind",
    "PollerThresholds",
    "Quote",
    "ScreenCriteria",
    "Symbol",
    "WatchedSymbol",
]
