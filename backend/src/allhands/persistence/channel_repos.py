"""Channel repository protocols + SQL implementations.

Kept in its own module (out of ``sql_repos.py``) so the Wave 2 notification-channels
feature lands as pure additions. Protocol + concrete repo types live together
to avoid a tiny extra file — both targets are internal to ``persistence``.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Protocol

from sqlalchemy import delete, select, update

from allhands.core.channel import (
    Channel,
    ChannelDirection,
    ChannelKind,
    ChannelMessage,
    ChannelMessageStatus,
    ChannelSubscription,
)
from allhands.persistence.orm.channels_orm import (
    ChannelMessageRow,
    ChannelRow,
    ChannelSubscriptionRow,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt


def _naive(dt: datetime) -> datetime:
    return dt.replace(tzinfo=None)


def _row_to_channel(row: ChannelRow) -> Channel:
    return Channel(
        id=row.id,
        kind=ChannelKind(row.kind),
        display_name=row.display_name,
        config=dict(row.config_json or {}),
        inbound_enabled=row.inbound_enabled,
        outbound_enabled=row.outbound_enabled,
        webhook_secret=row.webhook_secret,
        auto_approve_outbound=row.auto_approve_outbound,
        enabled=row.enabled,
        created_at=_utc(row.created_at),
        updated_at=_utc(row.updated_at),
    )


def _row_to_subscription(row: ChannelSubscriptionRow) -> ChannelSubscription:
    return ChannelSubscription(
        id=row.id,
        channel_id=row.channel_id,
        topic=row.topic,
        filter=dict(row.filter_json) if row.filter_json else None,
        enabled=row.enabled,
        created_at=_utc(row.created_at),
    )


def _row_to_message(row: ChannelMessageRow) -> ChannelMessage:
    return ChannelMessage(
        id=row.id,
        channel_id=row.channel_id,
        direction=ChannelDirection(row.direction),
        topic=row.topic,
        payload=dict(row.payload_json or {}),
        conversation_id=row.conversation_id,
        external_id=row.external_id,
        external_user_ref=row.external_user_ref,
        status=ChannelMessageStatus(row.status),
        error_message=row.error_message,
        created_at=_utc(row.created_at),
    )


class ChannelRepo(Protocol):
    async def get(self, channel_id: str) -> Channel | None: ...
    async def list_all(self, enabled_only: bool = False) -> list[Channel]: ...
    async def upsert(self, channel: Channel) -> Channel: ...
    async def delete(self, channel_id: str) -> None: ...


class ChannelSubscriptionRepo(Protocol):
    async def get(self, subscription_id: str) -> ChannelSubscription | None: ...
    async def list_for_channel(self, channel_id: str) -> list[ChannelSubscription]: ...
    async def list_for_topic(self, topic: str) -> list[ChannelSubscription]: ...
    async def upsert(self, subscription: ChannelSubscription) -> ChannelSubscription: ...
    async def delete(self, subscription_id: str) -> None: ...


class ChannelMessageRepo(Protocol):
    async def save(self, message: ChannelMessage) -> ChannelMessage: ...
    async def list_for_channel(
        self,
        channel_id: str,
        *,
        limit: int = 100,
        direction: ChannelDirection | None = None,
    ) -> list[ChannelMessage]: ...
    async def find_conversation_for_inbound(
        self,
        channel_id: str,
        external_user_ref: str,
    ) -> str | None: ...
    async def update_status(
        self,
        message_id: str,
        status: ChannelMessageStatus,
        *,
        external_id: str | None = None,
        error_message: str | None = None,
    ) -> None: ...


class SqlChannelRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, channel_id: str) -> Channel | None:
        row = await self._session.get(ChannelRow, channel_id)
        return _row_to_channel(row) if row else None

    async def list_all(self, enabled_only: bool = False) -> list[Channel]:
        stmt = select(ChannelRow).order_by(ChannelRow.created_at.desc())
        if enabled_only:
            stmt = stmt.where(ChannelRow.enabled.is_(True))
        result = await self._session.execute(stmt)
        return [_row_to_channel(r) for r in result.scalars().all()]

    async def upsert(self, channel: Channel) -> Channel:
        existing = await self._session.get(ChannelRow, channel.id)
        if existing is None:
            row = ChannelRow(
                id=channel.id,
                kind=channel.kind.value,
                display_name=channel.display_name,
                config_json=dict(channel.config),
                inbound_enabled=channel.inbound_enabled,
                outbound_enabled=channel.outbound_enabled,
                webhook_secret=channel.webhook_secret,
                auto_approve_outbound=channel.auto_approve_outbound,
                enabled=channel.enabled,
                created_at=_naive(channel.created_at),
                updated_at=_naive(channel.updated_at),
            )
            self._session.add(row)
            await self._session.flush()
            return channel
        existing.kind = channel.kind.value
        existing.display_name = channel.display_name
        existing.config_json = dict(channel.config)
        existing.inbound_enabled = channel.inbound_enabled
        existing.outbound_enabled = channel.outbound_enabled
        existing.webhook_secret = channel.webhook_secret
        existing.auto_approve_outbound = channel.auto_approve_outbound
        existing.enabled = channel.enabled
        existing.updated_at = _naive(channel.updated_at)
        await self._session.flush()
        return channel

    async def delete(self, channel_id: str) -> None:
        await self._session.execute(delete(ChannelRow).where(ChannelRow.id == channel_id))


class SqlChannelSubscriptionRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, subscription_id: str) -> ChannelSubscription | None:
        row = await self._session.get(ChannelSubscriptionRow, subscription_id)
        return _row_to_subscription(row) if row else None

    async def list_for_channel(self, channel_id: str) -> list[ChannelSubscription]:
        stmt = (
            select(ChannelSubscriptionRow)
            .where(ChannelSubscriptionRow.channel_id == channel_id)
            .order_by(ChannelSubscriptionRow.created_at.desc())
        )
        result = await self._session.execute(stmt)
        return [_row_to_subscription(r) for r in result.scalars().all()]

    async def list_for_topic(self, topic: str) -> list[ChannelSubscription]:
        stmt = select(ChannelSubscriptionRow).where(
            ChannelSubscriptionRow.enabled.is_(True),
            ChannelSubscriptionRow.topic.in_({topic, "*"}),
        )
        result = await self._session.execute(stmt)
        return [_row_to_subscription(r) for r in result.scalars().all()]

    async def upsert(self, subscription: ChannelSubscription) -> ChannelSubscription:
        existing = await self._session.get(ChannelSubscriptionRow, subscription.id)
        if existing is None:
            row = ChannelSubscriptionRow(
                id=subscription.id,
                channel_id=subscription.channel_id,
                topic=subscription.topic,
                filter_json=dict(subscription.filter) if subscription.filter else None,
                enabled=subscription.enabled,
                created_at=_naive(subscription.created_at),
            )
            self._session.add(row)
            await self._session.flush()
            return subscription
        existing.topic = subscription.topic
        existing.filter_json = dict(subscription.filter) if subscription.filter else None
        existing.enabled = subscription.enabled
        await self._session.flush()
        return subscription

    async def delete(self, subscription_id: str) -> None:
        await self._session.execute(
            delete(ChannelSubscriptionRow).where(ChannelSubscriptionRow.id == subscription_id)
        )


class SqlChannelMessageRepo:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def save(self, message: ChannelMessage) -> ChannelMessage:
        row = ChannelMessageRow(
            id=message.id,
            channel_id=message.channel_id,
            direction=message.direction.value,
            topic=message.topic,
            payload_json=dict(message.payload),
            conversation_id=message.conversation_id,
            external_id=message.external_id,
            external_user_ref=message.external_user_ref,
            status=message.status.value,
            error_message=message.error_message,
            created_at=_naive(message.created_at),
        )
        self._session.add(row)
        await self._session.flush()
        return message

    async def list_for_channel(
        self,
        channel_id: str,
        *,
        limit: int = 100,
        direction: ChannelDirection | None = None,
    ) -> list[ChannelMessage]:
        stmt = (
            select(ChannelMessageRow)
            .where(ChannelMessageRow.channel_id == channel_id)
            .order_by(ChannelMessageRow.created_at.desc())
            .limit(limit)
        )
        if direction is not None:
            stmt = stmt.where(ChannelMessageRow.direction == direction.value)
        result = await self._session.execute(stmt)
        return [_row_to_message(r) for r in result.scalars().all()]

    async def find_conversation_for_inbound(
        self,
        channel_id: str,
        external_user_ref: str,
    ) -> str | None:
        stmt = (
            select(ChannelMessageRow.conversation_id)
            .where(
                ChannelMessageRow.channel_id == channel_id,
                ChannelMessageRow.external_user_ref == external_user_ref,
                ChannelMessageRow.conversation_id.is_not(None),
            )
            .order_by(ChannelMessageRow.created_at.desc())
            .limit(1)
        )
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def update_status(
        self,
        message_id: str,
        status: ChannelMessageStatus,
        *,
        external_id: str | None = None,
        error_message: str | None = None,
    ) -> None:
        values: dict[str, Any] = {"status": status.value}
        if external_id is not None:
            values["external_id"] = external_id
        if error_message is not None:
            values["error_message"] = error_message
        await self._session.execute(
            update(ChannelMessageRow).where(ChannelMessageRow.id == message_id).values(**values)
        )


__all__ = [
    "ChannelMessageRepo",
    "ChannelRepo",
    "ChannelSubscriptionRepo",
    "SqlChannelMessageRepo",
    "SqlChannelRepo",
    "SqlChannelSubscriptionRepo",
]
