"""SMTP email adapter — v0 stub (spec § 4.3)."""

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


class EmailAdapter(ChannelAdapter):
    kind: ClassVar[ChannelKind] = ChannelKind.EMAIL
    supports_inbound: ClassVar[bool] = False
    config_fields: ClassVar[tuple[str, ...]] = (
        "smtp_host",
        "smtp_port",
        "username",
        "password",
        "from_addr",
        "to_addr",
        "use_tls",
    )

    async def send(self, channel: Channel, payload: NotificationPayload) -> DeliveryResult:
        del channel, payload
        raise NotImplementedError(
            "Email/SMTP outbound not yet implemented; register the channel but v0 only records config."
        )

    async def test_connection(self, channel: Channel) -> ChannelTestResult:
        del channel
        return ChannelTestResult(ok=False, detail="Email adapter is a v0 stub (NotImplemented)")


__all__ = ["EmailAdapter"]
