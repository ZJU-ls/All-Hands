"""WeCom (企业微信应用) adapter — v0 stub (spec § 4.3).

Declares config surface so the register wizard can render the form. Real
delivery + inbound signature (aes/cbc) live in v1.
"""

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


class WeComAdapter(ChannelAdapter):
    kind: ClassVar[ChannelKind] = ChannelKind.WECOM
    supports_inbound: ClassVar[bool] = True
    config_fields: ClassVar[tuple[str, ...]] = (
        "corp_id",
        "corp_secret",
        "agent_id",
        "to_user",
    )

    async def send(self, channel: Channel, payload: NotificationPayload) -> DeliveryResult:
        del channel, payload
        raise NotImplementedError(
            "WeCom outbound not yet implemented; register the channel but v0 only records config."
        )

    async def test_connection(self, channel: Channel) -> ChannelTestResult:
        del channel
        return ChannelTestResult(ok=False, detail="WeCom adapter is a v0 stub (NotImplemented)")


__all__ = ["WeComAdapter"]
