"""ChannelService — spec § 5.1.

One service backs both the REST router (UI) and the Meta Tools (Lead Agent).
The service owns adapter dispatch + subscription routing + audit-row writes;
adapters never touch the database.

Inbound delivery calls a pluggable ``InboundHandler`` callback (defined in
``execution.channels.inbound``) so the conversation-service wiring does not
need to live here (keeps services → services dependencies out of the
persistence + execution layers).
"""

from __future__ import annotations

import hashlib
import hmac
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from allhands.core.channel import (
    Channel,
    ChannelDirection,
    ChannelKind,
    ChannelMessage,
    ChannelMessageStatus,
    ChannelSubscription,
    ChannelTestResult,
    DeliveryResult,
    InboundMessage,
    NotificationPayload,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from allhands.execution.channels.base import ChannelAdapter
    from allhands.persistence.channel_repos import (
        ChannelMessageRepo,
        ChannelRepo,
        ChannelSubscriptionRepo,
    )

    InboundHandler = Callable[[InboundMessage, Channel], Awaitable[str | None]]
    """Given a parsed inbound message + channel, returns the conversation_id it was routed to."""


class ChannelNotFoundError(Exception):
    def __init__(self, channel_id: str) -> None:
        super().__init__(f"Channel not found: {channel_id}")
        self.channel_id = channel_id


class ChannelKindNotSupportedError(Exception):
    def __init__(self, kind: str) -> None:
        super().__init__(f"No adapter registered for kind: {kind}")
        self.kind = kind


class ChannelSignatureError(Exception):
    """Inbound webhook signature verification failed."""


def _subscription_matches(subscription: ChannelSubscription, payload: NotificationPayload) -> bool:
    if not subscription.enabled:
        return False
    filt = subscription.filter or {}
    if not filt:
        return True
    severities = filt.get("severity")
    if severities and payload.severity not in severities:
        return False
    symbols = filt.get("symbols")
    if symbols:
        payload_symbol = payload.meta.get("symbol") if payload.meta else None
        if payload_symbol is None or payload_symbol not in symbols:
            return False
    return True


class ChannelService:
    def __init__(
        self,
        channel_repo: ChannelRepo,
        subscription_repo: ChannelSubscriptionRepo,
        message_repo: ChannelMessageRepo,
        adapters: dict[ChannelKind, ChannelAdapter],
        *,
        inbound_handler: InboundHandler | None = None,
    ) -> None:
        self._channels = channel_repo
        self._subscriptions = subscription_repo
        self._messages = message_repo
        self._adapters = adapters
        self._inbound_handler = inbound_handler

    # -- channel CRUD ---------------------------------------------------

    async def register(
        self,
        *,
        kind: ChannelKind,
        display_name: str,
        config: dict[str, Any],
        inbound_enabled: bool = False,
        outbound_enabled: bool = True,
        auto_approve_outbound: bool = False,
        webhook_secret: str | None = None,
    ) -> Channel:
        if kind not in self._adapters:
            raise ChannelKindNotSupportedError(kind.value)
        now = datetime.now(UTC)
        channel = Channel(
            id=f"ch_{uuid.uuid4().hex[:16]}",
            kind=kind,
            display_name=display_name,
            config=dict(config),
            inbound_enabled=inbound_enabled,
            outbound_enabled=outbound_enabled,
            webhook_secret=webhook_secret,
            auto_approve_outbound=auto_approve_outbound,
            enabled=True,
            created_at=now,
            updated_at=now,
        )
        await self._channels.upsert(channel)
        return channel

    async def list_channels(self, enabled_only: bool = False) -> list[Channel]:
        return await self._channels.list_all(enabled_only=enabled_only)

    async def get(self, channel_id: str) -> Channel:
        channel = await self._channels.get(channel_id)
        if channel is None:
            raise ChannelNotFoundError(channel_id)
        return channel

    async def update(
        self,
        channel_id: str,
        *,
        display_name: str | None = None,
        config: dict[str, Any] | None = None,
        inbound_enabled: bool | None = None,
        outbound_enabled: bool | None = None,
        auto_approve_outbound: bool | None = None,
        webhook_secret: str | None = None,
        enabled: bool | None = None,
    ) -> Channel:
        current = await self.get(channel_id)
        updated = current.model_copy(
            update={
                "display_name": display_name if display_name is not None else current.display_name,
                "config": dict(config) if config is not None else current.config,
                "inbound_enabled": (
                    inbound_enabled if inbound_enabled is not None else current.inbound_enabled
                ),
                "outbound_enabled": (
                    outbound_enabled if outbound_enabled is not None else current.outbound_enabled
                ),
                "auto_approve_outbound": (
                    auto_approve_outbound
                    if auto_approve_outbound is not None
                    else current.auto_approve_outbound
                ),
                "webhook_secret": (
                    webhook_secret if webhook_secret is not None else current.webhook_secret
                ),
                "enabled": enabled if enabled is not None else current.enabled,
                "updated_at": datetime.now(UTC),
            }
        )
        await self._channels.upsert(updated)
        return updated

    async def delete(self, channel_id: str) -> None:
        await self._channels.delete(channel_id)

    async def test(self, channel_id: str) -> ChannelTestResult:
        channel = await self.get(channel_id)
        adapter = self._adapter_for(channel.kind)
        return await adapter.test_connection(channel)

    # -- subscriptions --------------------------------------------------

    async def list_subscriptions(self, channel_id: str) -> list[ChannelSubscription]:
        await self.get(channel_id)
        return await self._subscriptions.list_for_channel(channel_id)

    async def list_subscriptions_for_topic(self, topic: str) -> list[ChannelSubscription]:
        return await self._subscriptions.list_for_topic(topic)

    async def add_subscription(
        self,
        channel_id: str,
        *,
        topic: str,
        filter: dict[str, Any] | None = None,
    ) -> ChannelSubscription:
        await self.get(channel_id)
        sub = ChannelSubscription(
            id=f"sub_{uuid.uuid4().hex[:16]}",
            channel_id=channel_id,
            topic=topic,
            filter=filter,
            enabled=True,
            created_at=datetime.now(UTC),
        )
        await self._subscriptions.upsert(sub)
        return sub

    async def update_subscription(
        self,
        subscription_id: str,
        *,
        topic: str | None = None,
        filter: dict[str, Any] | None = None,
        enabled: bool | None = None,
    ) -> ChannelSubscription:
        current = await self._subscriptions.get(subscription_id)
        if current is None:
            raise ChannelNotFoundError(subscription_id)
        updated = current.model_copy(
            update={
                "topic": topic if topic is not None else current.topic,
                "filter": filter if filter is not None else current.filter,
                "enabled": enabled if enabled is not None else current.enabled,
            }
        )
        await self._subscriptions.upsert(updated)
        return updated

    async def delete_subscription(self, subscription_id: str) -> None:
        await self._subscriptions.delete(subscription_id)

    # -- sending --------------------------------------------------------

    async def notify(
        self,
        payload: NotificationPayload,
        topic: str,
        *,
        channel_ids: list[str] | None = None,
        conversation_id: str | None = None,
    ) -> list[DeliveryResult]:
        """Deliver ``payload`` to every matching channel.

        When ``channel_ids`` is None, look up subscriptions by ``topic`` +
        payload filter. Otherwise broadcast to the given channels verbatim.
        """
        targets: list[Channel]
        if channel_ids is not None:
            targets = [await self.get(cid) for cid in channel_ids]
        else:
            subs = await self._subscriptions.list_for_topic(topic)
            seen: set[str] = set()
            targets = []
            for sub in subs:
                if sub.channel_id in seen:
                    continue
                if not _subscription_matches(sub, payload):
                    continue
                channel = await self._channels.get(sub.channel_id)
                if channel is None or not channel.enabled or not channel.outbound_enabled:
                    continue
                targets.append(channel)
                seen.add(sub.channel_id)
        results: list[DeliveryResult] = []
        for channel in targets:
            result = await self._send_one(
                channel, payload, topic=topic, conversation_id=conversation_id
            )
            results.append(result)
        return results

    async def send_direct(
        self,
        channel_id: str,
        payload: NotificationPayload,
        *,
        topic: str | None = None,
        conversation_id: str | None = None,
    ) -> DeliveryResult:
        channel = await self.get(channel_id)
        if not channel.outbound_enabled:
            return DeliveryResult(
                channel_id=channel_id,
                status=ChannelMessageStatus.FAILED,
                error_message="outbound disabled for this channel",
            )
        return await self._send_one(channel, payload, topic=topic, conversation_id=conversation_id)

    async def _send_one(
        self,
        channel: Channel,
        payload: NotificationPayload,
        *,
        topic: str | None,
        conversation_id: str | None,
    ) -> DeliveryResult:
        message = ChannelMessage(
            id=f"cm_{uuid.uuid4().hex[:16]}",
            channel_id=channel.id,
            direction=ChannelDirection.OUT,
            topic=topic,
            payload=payload.model_dump(),
            conversation_id=conversation_id,
            status=ChannelMessageStatus.PENDING,
            created_at=datetime.now(UTC),
        )
        await self._messages.save(message)
        adapter = self._adapter_for(channel.kind)
        try:
            result = await adapter.send(channel, payload)
        except NotImplementedError as exc:
            await self._messages.update_status(
                message.id,
                ChannelMessageStatus.FAILED,
                error_message=f"adapter not implemented: {exc!s}",
            )
            return DeliveryResult(
                channel_id=channel.id,
                status=ChannelMessageStatus.FAILED,
                error_message=f"adapter not implemented: {exc!s}",
            )
        await self._messages.update_status(
            message.id,
            result.status,
            external_id=result.external_id,
            error_message=result.error_message,
        )
        return result

    # -- inbound --------------------------------------------------------

    async def handle_inbound(
        self,
        channel_id: str,
        headers: dict[str, str],
        body: bytes,
    ) -> InboundMessage:
        channel = await self.get(channel_id)
        if not channel.inbound_enabled:
            raise ChannelSignatureError("channel has inbound_enabled=false")
        adapter = self._adapter_for(channel.kind)
        if not await adapter.verify_signature(channel, headers, body):
            raise ChannelSignatureError("webhook signature mismatch")
        inbound = await adapter.parse_inbound(channel, headers, body)
        conv_id: str | None = None
        if self._inbound_handler is not None:
            conv_id = await self._inbound_handler(inbound, channel)
        message = ChannelMessage(
            id=f"cm_{uuid.uuid4().hex[:16]}",
            channel_id=channel.id,
            direction=ChannelDirection.IN,
            topic=None,
            payload={"text": inbound.text, "raw": inbound.raw},
            conversation_id=conv_id,
            external_user_ref=inbound.external_user_ref,
            status=ChannelMessageStatus.RECEIVED,
            created_at=inbound.received_at,
        )
        await self._messages.save(message)
        return inbound

    async def list_messages(
        self,
        channel_id: str,
        *,
        limit: int = 100,
        direction: ChannelDirection | None = None,
    ) -> list[ChannelMessage]:
        await self.get(channel_id)
        return await self._messages.list_for_channel(channel_id, limit=limit, direction=direction)

    async def find_conversation_for_inbound(
        self,
        channel_id: str,
        external_user_ref: str,
    ) -> str | None:
        return await self._messages.find_conversation_for_inbound(channel_id, external_user_ref)

    # -- helpers --------------------------------------------------------

    def adapter_for_kind(self, kind: ChannelKind) -> ChannelAdapter:
        return self._adapter_for(kind)

    def _adapter_for(self, kind: ChannelKind) -> ChannelAdapter:
        adapter = self._adapters.get(kind)
        if adapter is None:
            raise ChannelKindNotSupportedError(kind.value)
        return adapter

    @staticmethod
    def compute_default_signature(secret: str, body: bytes) -> str:
        """Expose the generic HMAC-SHA256 signer so webhook clients can mirror it."""
        return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


__all__ = [
    "ChannelKindNotSupportedError",
    "ChannelNotFoundError",
    "ChannelService",
    "ChannelSignatureError",
]
