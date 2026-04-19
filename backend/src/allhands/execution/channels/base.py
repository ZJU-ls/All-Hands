"""ChannelAdapter ABC (spec § 4.1).

Each adapter owns transport + signature + payload rendering. The service layer
calls ``send`` for outbound delivery and ``parse_inbound`` for webhook ingest.

Adapters that do not support inbound raise ``ChannelAdapterInboundNotSupported``
from the base class; the service treats this as a 405 at the webhook boundary.
"""

from __future__ import annotations

import hashlib
import hmac
from abc import ABC, abstractmethod
from typing import ClassVar

from allhands.core.channel import (
    Channel,
    ChannelKind,
    ChannelTestResult,
    DeliveryResult,
    InboundMessage,
    NotificationPayload,
)


class ChannelAdapterError(Exception):
    """Adapter-level failure; the service converts this to a failed message row."""


class ChannelAdapterInboundNotSupported(ChannelAdapterError):
    """Raised by ``parse_inbound`` on adapters that are outbound-only."""


class ChannelAdapter(ABC):
    """Driver for one channel kind.

    ``send`` MUST return a ``DeliveryResult`` even on failure (status=FAILED +
    error_message); exceptions are reserved for unrecoverable programming
    errors (bad config types, invalid enum values, etc.).
    """

    kind: ClassVar[ChannelKind]
    supports_inbound: ClassVar[bool] = False
    config_fields: ClassVar[tuple[str, ...]] = ()

    @abstractmethod
    async def send(self, channel: Channel, payload: NotificationPayload) -> DeliveryResult:
        """Outbound delivery — return status + external id + elapsed ms."""

    async def parse_inbound(
        self,
        channel: Channel,
        headers: dict[str, str],
        body: bytes,
    ) -> InboundMessage:
        """Parse inbound webhook body → ``InboundMessage``.

        Adapters that do not support inbound raise ``ChannelAdapterInboundNotSupported``.
        The default implementation raises; override when supported.
        """
        del channel, headers, body
        raise ChannelAdapterInboundNotSupported(
            f"{self.kind.value} adapter does not support inbound messages"
        )

    async def verify_signature(
        self,
        channel: Channel,
        headers: dict[str, str],
        body: bytes,
    ) -> bool:
        """Default: HMAC-SHA256 over body using channel.webhook_secret.

        Adapters with platform-specific signing (Slack, Feishu) override.
        When ``webhook_secret`` is empty, verification is skipped (local dev).
        """
        secret = channel.webhook_secret
        if not secret:
            return True
        provided = headers.get("x-signature") or headers.get("X-Signature")
        if not provided:
            return False
        mac = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(mac, provided)

    @abstractmethod
    async def test_connection(self, channel: Channel) -> ChannelTestResult:
        """Configuration probe invoked from the UI register wizard."""


__all__ = [
    "ChannelAdapter",
    "ChannelAdapterError",
    "ChannelAdapterInboundNotSupported",
]
