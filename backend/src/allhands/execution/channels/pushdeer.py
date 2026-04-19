"""PushDeer adapter — v0 stub (spec § 4.3)."""

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


class PushDeerAdapter(ChannelAdapter):
    kind: ClassVar[ChannelKind] = ChannelKind.PUSHDEER
    supports_inbound: ClassVar[bool] = False
    config_fields: ClassVar[tuple[str, ...]] = ("push_key", "server_url")

    async def send(self, channel: Channel, payload: NotificationPayload) -> DeliveryResult:
        del channel, payload
        raise NotImplementedError(
            "PushDeer outbound not yet implemented; register the channel but v0 only records config."
        )

    async def test_connection(self, channel: Channel) -> ChannelTestResult:
        del channel
        return ChannelTestResult(ok=False, detail="PushDeer adapter is a v0 stub (NotImplemented)")


__all__ = ["PushDeerAdapter"]
