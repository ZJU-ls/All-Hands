"""Feishu (飞书) bot adapter — v0 stub (spec § 4.3)."""

from __future__ import annotations

from typing import ClassVar

from allhands.core.channel import (
    Channel,
    ChannelKind,
    ChannelTestResult,
    DeliveryResult,
    NotificationPayload,
)
from allhands.execution.channels.base import ChannelAdapter


class FeishuAdapter(ChannelAdapter):
    kind: ClassVar[ChannelKind] = ChannelKind.FEISHU
    supports_inbound: ClassVar[bool] = True
    config_fields: ClassVar[tuple[str, ...]] = ("webhook_url", "signing_secret")

    async def send(self, channel: Channel, payload: NotificationPayload) -> DeliveryResult:
        del channel, payload
        raise NotImplementedError(
            "Feishu outbound not yet implemented; register the channel but v0 only records config."
        )

    async def test_connection(self, channel: Channel) -> ChannelTestResult:
        del channel
        return ChannelTestResult(ok=False, detail="Feishu adapter is a v0 stub (NotImplemented)")


__all__ = ["FeishuAdapter"]
