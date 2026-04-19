"""Bark iOS adapter — outbound only (spec § 4.2).

https://day.app/ is the default Bark server; user-hosted servers override via
``config.server_url``. Single HTTP GET with URL-encoded title/body.
"""

from __future__ import annotations

import time
from typing import Any, ClassVar
from urllib.parse import quote

import httpx

from allhands.core.channel import (
    Channel,
    ChannelKind,
    ChannelMessageStatus,
    ChannelTestResult,
    DeliveryResult,
    NotificationPayload,
)
from allhands.execution.channels.base import ChannelAdapter

_DEFAULT_BARK_SERVER = "https://api.day.app"


_SEVERITY_SOUND = {
    "P0": "alarm",
    "P1": "bell",
    "P2": "shake",
    "warn": "glass",
    "info": "",
}


class BarkAdapter(ChannelAdapter):
    kind: ClassVar[ChannelKind] = ChannelKind.BARK
    supports_inbound: ClassVar[bool] = False
    config_fields: ClassVar[tuple[str, ...]] = ("device_key", "server_url")

    http_factory: Any = None

    def _client(self) -> httpx.AsyncClient:
        if self.http_factory is not None:
            return self.http_factory()  # type: ignore[no-any-return]
        return httpx.AsyncClient(timeout=5.0)

    async def send(self, channel: Channel, payload: NotificationPayload) -> DeliveryResult:
        key = channel.config.get("device_key")
        if not key:
            return DeliveryResult(
                channel_id=channel.id,
                status=ChannelMessageStatus.FAILED,
                error_message="bark adapter requires device_key in config",
            )
        server = channel.config.get("server_url") or _DEFAULT_BARK_SERVER
        title_q = quote(payload.title, safe="")
        body_q = quote(payload.body or "", safe="")
        sound = _SEVERITY_SOUND.get(payload.severity, "")
        url = f"{server.rstrip('/')}/{key}/{title_q}/{body_q}"
        if sound:
            url += f"?sound={sound}"
        started = time.perf_counter()
        try:
            async with self._client() as client:
                resp = await client.get(url)
        except httpx.HTTPError as exc:
            return DeliveryResult(
                channel_id=channel.id,
                status=ChannelMessageStatus.FAILED,
                error_message=f"bark transport error: {exc!s}",
                elapsed_ms=int((time.perf_counter() - started) * 1000),
            )
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        if resp.status_code >= 400:
            return DeliveryResult(
                channel_id=channel.id,
                status=ChannelMessageStatus.FAILED,
                error_message=f"bark api {resp.status_code}: {resp.text[:200]}",
                elapsed_ms=elapsed_ms,
            )
        return DeliveryResult(
            channel_id=channel.id,
            status=ChannelMessageStatus.DELIVERED,
            elapsed_ms=elapsed_ms,
        )

    async def test_connection(self, channel: Channel) -> ChannelTestResult:
        key = channel.config.get("device_key")
        if not key:
            return ChannelTestResult(ok=False, detail="missing device_key")
        server = channel.config.get("server_url") or _DEFAULT_BARK_SERVER
        url = f"{server.rstrip('/')}/{key}/{quote('allhands test', safe='')}/{quote('ok', safe='')}"
        started = time.perf_counter()
        try:
            async with self._client() as client:
                resp = await client.get(url)
        except httpx.HTTPError as exc:
            return ChannelTestResult(
                ok=False,
                detail=f"transport error: {exc!s}",
                latency_ms=int((time.perf_counter() - started) * 1000),
            )
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        if resp.status_code >= 400:
            return ChannelTestResult(
                ok=False,
                detail=f"bark api {resp.status_code}",
                latency_ms=elapsed_ms,
            )
        return ChannelTestResult(ok=True, latency_ms=elapsed_ms)


__all__ = ["BarkAdapter"]
