"""Provider parsing / error paths (spec § 12)."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
import pytest

from allhands.execution.market.base import (
    Capability,
    ProviderError,
    ProviderNotSupported,
)
from allhands.execution.market.sina_realtime import SinaRealtimeProvider, _to_sina_code

SINA_FIXTURE = (
    'var hq_str_sh600519="贵州茅台,1680.00,1700.00,1720.00,1730.00,1695.00,'
    "1720.01,1720.02,3000,5160000,10,1720.0,20,1720.1,30,1720.2,40,1720.3,"
    "50,1720.4,60,1720.0,70,1719.9,80,1719.8,90,1719.7,100,1719.6,110,"
    '2026-04-19,15:00:00,00,";'
)


class _MockClient:
    def __init__(self, responses: list[httpx.Response]) -> None:
        self._responses = list(responses)

    async def __aenter__(self) -> _MockClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None

    async def get(self, url: str) -> httpx.Response:
        return self._responses.pop(0)


def _req() -> httpx.Request:
    return httpx.Request("GET", "https://example.test")


def test_to_sina_code_maps_exchange() -> None:
    assert _to_sina_code("SSE:600519") == "sh600519"
    assert _to_sina_code("SZSE:000001") == "sz000001"


def test_to_sina_code_rejects_unknown_exchange() -> None:
    with pytest.raises(ProviderNotSupported):
        _to_sina_code("HKEX:00700")


def test_sina_parses_real_quote() -> None:
    provider = SinaRealtimeProvider()
    provider.http_factory = lambda: _MockClient(
        [httpx.Response(200, text=SINA_FIXTURE, request=_req())]
    )
    quote = asyncio.run(provider.get_quote("SSE:600519"))
    assert quote.source == "sina_realtime"
    assert quote.last > 0
    assert quote.prev_close is not None


def test_sina_http_error_raises_transient() -> None:
    from allhands.execution.market.base import TransientError

    provider = SinaRealtimeProvider()
    provider.http_factory = lambda: _MockClient([httpx.Response(500, text="", request=_req())])
    with pytest.raises(TransientError):
        asyncio.run(provider.get_quote("SSE:600519"))


def test_sina_malformed_body_raises_provider_error() -> None:
    provider = SinaRealtimeProvider()
    provider.http_factory = lambda: _MockClient(
        [httpx.Response(200, text='var hq_str_sh600519="malformed";', request=_req())]
    )
    with pytest.raises(ProviderError):
        asyncio.run(provider.get_quote("SSE:600519"))


def test_stub_providers_declare_empty_capabilities() -> None:
    from allhands.execution.market import (
        EfinanceProvider,
        TushareProProvider,
        XtQuantProvider,
    )

    assert TushareProProvider.capabilities == set()
    assert XtQuantProvider.capabilities == set()
    assert EfinanceProvider.capabilities == set()


def test_akshare_missing_package_raises_not_supported(monkeypatch: pytest.MonkeyPatch) -> None:
    from allhands.execution.market import akshare_provider

    monkeypatch.setattr(
        akshare_provider,
        "_load_akshare",
        lambda: (_ for _ in ()).throw(ProviderNotSupported("missing")),
    )
    provider = akshare_provider.AkshareProvider()
    with pytest.raises(ProviderNotSupported):
        asyncio.run(provider.get_quote("SSE:600519"))


def test_akshare_with_fake_module_returns_quote() -> None:
    from decimal import Decimal

    from allhands.execution.market.akshare_provider import AkshareProvider

    class _FakeDF:
        def __init__(self, rows: list[dict[str, Any]]) -> None:
            self._rows = rows

        def to_dict(self, _orient: str) -> list[dict[str, Any]]:
            return self._rows

    class _FakeAk:
        def stock_bid_ask_em(self, symbol: str) -> _FakeDF:
            del symbol
            return _FakeDF([{"最新": "100.50", "昨收": "99.00"}])

    provider = AkshareProvider()
    provider.akshare_module = _FakeAk()
    quote = asyncio.run(provider.get_quote("SSE:600519"))
    assert quote.last == Decimal("100.50")
    assert quote.prev_close == Decimal("99.00")
    assert quote.change > 0


def test_provider_base_returns_from_capabilities_correctly() -> None:
    from allhands.execution.market import SinaRealtimeProvider

    assert Capability.QUOTE in SinaRealtimeProvider.capabilities
    assert Capability.BARS not in SinaRealtimeProvider.capabilities
