"""ORM rows for notification-channels (spec § 3).

Imported by ``persistence.orm`` so alembic ``Base.metadata`` sees these tables.
Storage shapes only — mapping to ``core.channel`` aggregates happens in
``persistence.channel_repos``.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from allhands.persistence.orm.base import Base


class ChannelRow(Base):
    __tablename__ = "channels"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    display_name: Mapped[str] = mapped_column(String(128))
    config_json: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    inbound_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    outbound_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    webhook_secret: Mapped[str | None] = mapped_column(String(128), nullable=True)
    auto_approve_outbound: Mapped[bool] = mapped_column(Boolean, default=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    updated_at: Mapped[datetime] = mapped_column(DateTime)


class ChannelSubscriptionRow(Base):
    __tablename__ = "channel_subscriptions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    channel_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("channels.id", ondelete="CASCADE"),
        index=True,
    )
    topic: Mapped[str] = mapped_column(String(128), index=True)
    filter_json: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)


class ChannelMessageRow(Base):
    __tablename__ = "channel_messages"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    channel_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("channels.id", ondelete="CASCADE"),
        index=True,
    )
    direction: Mapped[str] = mapped_column(String(8))
    topic: Mapped[str | None] = mapped_column(String(128), nullable=True)
    payload_json: Mapped[dict[str, object]] = mapped_column(JSON, default=dict)
    conversation_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    external_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    external_user_ref: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    error_message: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, index=True)


__all__ = ["ChannelMessageRow", "ChannelRow", "ChannelSubscriptionRow"]
