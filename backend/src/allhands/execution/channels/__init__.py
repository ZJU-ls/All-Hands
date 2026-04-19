"""Channel adapters — spec § 4.

Discovery function returns an immutable mapping ``ChannelKind -> ChannelAdapter``.
The service layer consumes it via ``get_channel_registry`` so tests can stub a
subset. Adapters are singletons; their state is per-Channel (passed on call).
"""

from __future__ import annotations

from allhands.core.channel import ChannelKind
from allhands.execution.channels.bark import BarkAdapter
from allhands.execution.channels.base import (
    ChannelAdapter,
    ChannelAdapterError,
    ChannelAdapterInboundNotSupported,
)
from allhands.execution.channels.email import EmailAdapter
from allhands.execution.channels.feishu import FeishuAdapter
from allhands.execution.channels.pushdeer import PushDeerAdapter
from allhands.execution.channels.telegram import TelegramAdapter
from allhands.execution.channels.wecom import WeComAdapter


def discover_channel_adapters() -> dict[ChannelKind, ChannelAdapter]:
    """Return the default adapter map. One instance per kind."""

    adapters: list[ChannelAdapter] = [
        TelegramAdapter(),
        BarkAdapter(),
        WeComAdapter(),
        FeishuAdapter(),
        EmailAdapter(),
        PushDeerAdapter(),
    ]
    return {a.kind: a for a in adapters}


__all__ = [
    "BarkAdapter",
    "ChannelAdapter",
    "ChannelAdapterError",
    "ChannelAdapterInboundNotSupported",
    "EmailAdapter",
    "FeishuAdapter",
    "PushDeerAdapter",
    "TelegramAdapter",
    "WeComAdapter",
    "discover_channel_adapters",
]
