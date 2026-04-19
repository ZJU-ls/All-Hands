"""Market data providers + router + poller.

The ``build_default_router`` helper wires a sane free-tier router for the
service layer: priority [sina_realtime, akshare, baostock], stubs registered
for observability but never selected (they advertise empty capabilities).
"""

from __future__ import annotations

from allhands.execution.market.akshare_provider import AkshareProvider
from allhands.execution.market.baostock_provider import BaoStockProvider
from allhands.execution.market.base import (
    Capability,
    MarketDataProvider,
    ProviderError,
    ProviderNotSupported,
    RateLimitError,
    TransientError,
)
from allhands.execution.market.efinance_provider import EfinanceProvider
from allhands.execution.market.poller import MarketPoller, detect_anomaly
from allhands.execution.market.router import MarketDataRouter, NoProviderAvailableError
from allhands.execution.market.sina_realtime import SinaRealtimeProvider
from allhands.execution.market.tushare_pro import TushareProProvider
from allhands.execution.market.xtquant import XtQuantProvider

DEFAULT_PRIORITY: list[str] = [
    "sina_realtime",
    "akshare",
    "baostock",
    "tushare_pro",
    "efinance",
    "xtquant",
]


def discover_market_providers() -> list[MarketDataProvider]:
    """Return a fresh list of every known provider (real + stub).

    Missing optional deps (akshare / baostock) surface at call time as
    ``ProviderNotSupported`` which the router handles.
    """
    return [
        SinaRealtimeProvider(),
        AkshareProvider(),
        BaoStockProvider(),
        TushareProProvider(),
        EfinanceProvider(),
        XtQuantProvider(),
    ]


def build_default_router() -> MarketDataRouter:
    return MarketDataRouter(discover_market_providers(), DEFAULT_PRIORITY)


__all__ = [
    "DEFAULT_PRIORITY",
    "AkshareProvider",
    "BaoStockProvider",
    "Capability",
    "EfinanceProvider",
    "MarketDataProvider",
    "MarketDataRouter",
    "MarketPoller",
    "NoProviderAvailableError",
    "ProviderError",
    "ProviderNotSupported",
    "RateLimitError",
    "SinaRealtimeProvider",
    "TransientError",
    "TushareProProvider",
    "XtQuantProvider",
    "build_default_router",
    "detect_anomaly",
    "discover_market_providers",
]
