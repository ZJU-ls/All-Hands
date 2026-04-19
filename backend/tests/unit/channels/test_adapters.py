"""Channel adapter unit tests — send/parse/signature path (spec § 12)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import httpx
import pytest

from allhands.core.channel import (
    Channel,
    ChannelKind,
    ChannelMessageStatus,
    NotificationPayload,
)
from allhands.execution.channels import discover_channel_adapters
from allhands.execution.channels.bark import BarkAdapter
from allhands.execution.channels.base import ChannelAdapterError, ChannelAdapterInboundNotSupported
from allhands.execution.channels.telegram import TelegramAdapter


def _channel(kind: ChannelKind, config: dict[str, Any], *, secret: str | None = None) -> Channel:
    now = datetime.now(UTC)
    return Channel(
        id="ch_test",
        kind=kind,
        display_name="test",
        config=config,
        inbound_enabled=True,
        outbound_enabled=True,
        webhook_secret=secret,
        auto_approve_outbound=False,
        enabled=True,
        created_at=now,
        updated_at=now,
    )


class _MockHttpClient:
    def __init__(self, responses: list[httpx.Response]) -> None:
        self._responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    async def __aenter__(self) -> _MockHttpClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None

    async def post(self, url: str, json: dict[str, Any] | None = None) -> httpx.Response:
        self.calls.append({"method": "POST", "url": url, "json": json})
        return self._responses.pop(0)

    async def get(self, url: str) -> httpx.Response:
        self.calls.append({"method": "GET", "url": url})
        return self._responses.pop(0)


def _mock_request() -> httpx.Request:
    return httpx.Request("POST", "https://example.test/")


def test_discover_returns_all_kinds() -> None:
    adapters = discover_channel_adapters()
    assert set(adapters.keys()) == set(ChannelKind)


def test_telegram_send_delivered() -> None:
    import asyncio

    adapter = TelegramAdapter()
    adapter.http_factory = lambda: _MockHttpClient(
        [
            httpx.Response(
                200,
                json={"ok": True, "result": {"message_id": 42}},
                request=_mock_request(),
            )
        ]
    )
    channel = _channel(ChannelKind.TELEGRAM, {"bot_token": "abc", "chat_id": "123"})
    payload = NotificationPayload(title="hi", body="world", severity="info")
    result = asyncio.run(adapter.send(channel, payload))
    assert result.status is ChannelMessageStatus.DELIVERED
    assert result.external_id == "42"


def test_telegram_send_api_error_returns_failed() -> None:
    import asyncio

    adapter = TelegramAdapter()
    adapter.http_factory = lambda: _MockHttpClient(
        [httpx.Response(400, text="bad request", request=_mock_request())]
    )
    channel = _channel(ChannelKind.TELEGRAM, {"bot_token": "abc", "chat_id": "123"})
    payload = NotificationPayload(title="hi")
    result = asyncio.run(adapter.send(channel, payload))
    assert result.status is ChannelMessageStatus.FAILED
    assert "400" in (result.error_message or "")


def test_telegram_missing_config_fails_gracefully() -> None:
    import asyncio

    adapter = TelegramAdapter()
    channel = _channel(ChannelKind.TELEGRAM, {})
    result = asyncio.run(adapter.send(channel, NotificationPayload(title="hi")))
    assert result.status is ChannelMessageStatus.FAILED


def test_telegram_parse_inbound_reads_chat_id() -> None:
    import asyncio

    adapter = TelegramAdapter()
    channel = _channel(ChannelKind.TELEGRAM, {"bot_token": "abc", "chat_id": "123"})
    body = b'{"message": {"chat": {"id": 123456}, "text": "hello"}}'
    inbound = asyncio.run(adapter.parse_inbound(channel, {}, body))
    assert inbound.external_user_ref == "123456"
    assert inbound.text == "hello"


def test_telegram_parse_inbound_rejects_without_chat_id() -> None:
    import asyncio

    adapter = TelegramAdapter()
    channel = _channel(ChannelKind.TELEGRAM, {"bot_token": "abc", "chat_id": "123"})
    with pytest.raises(ChannelAdapterError):
        asyncio.run(adapter.parse_inbound(channel, {}, b'{"message": {}}'))


def test_telegram_signature_header_match() -> None:
    import asyncio

    adapter = TelegramAdapter()
    channel = _channel(ChannelKind.TELEGRAM, {}, secret="super-secret")
    headers = {"x-telegram-bot-api-secret-token": "super-secret"}
    assert asyncio.run(adapter.verify_signature(channel, headers, b""))
    assert not asyncio.run(adapter.verify_signature(channel, {}, b""))


def test_bark_send_delivered() -> None:
    import asyncio

    adapter = BarkAdapter()
    adapter.http_factory = lambda: _MockHttpClient(
        [httpx.Response(200, text="ok", request=_mock_request())]
    )
    channel = _channel(ChannelKind.BARK, {"device_key": "dkey"})
    result = asyncio.run(adapter.send(channel, NotificationPayload(title="hi", severity="P1")))
    assert result.status is ChannelMessageStatus.DELIVERED


def test_bark_missing_key_fails() -> None:
    import asyncio

    adapter = BarkAdapter()
    channel = _channel(ChannelKind.BARK, {})
    result = asyncio.run(adapter.send(channel, NotificationPayload(title="hi")))
    assert result.status is ChannelMessageStatus.FAILED


@pytest.mark.parametrize(
    "kind",
    [
        ChannelKind.WECOM,
        ChannelKind.FEISHU,
        ChannelKind.EMAIL,
        ChannelKind.PUSHDEER,
    ],
)
def test_stub_adapters_raise_not_implemented(kind: ChannelKind) -> None:
    """Stubs (spec § 4.3) must declare themselves with NotImplementedError on send."""
    import asyncio

    adapters = discover_channel_adapters()
    adapter = adapters[kind]
    channel = _channel(kind, {})
    with pytest.raises(NotImplementedError):
        asyncio.run(adapter.send(channel, NotificationPayload(title="hi")))


def test_stub_inbound_raises_not_supported() -> None:
    """Base ABC defaults parse_inbound to NotSupported for outbound-only adapters."""
    import asyncio

    adapter = BarkAdapter()
    channel = _channel(ChannelKind.BARK, {})
    with pytest.raises(ChannelAdapterInboundNotSupported):
        asyncio.run(adapter.parse_inbound(channel, {}, b""))
