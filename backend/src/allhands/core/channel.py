"""Channel domain model — out/in notification abstraction (spec § 3.4).

A Channel is a resource, not code. Drivers live in ``execution/channels`` and
are routed by ``kind``. Payloads and inbound messages are plain Pydantic so
the service + adapter boundary stays thin.

The module intentionally avoids referencing any transport library; adapters
own their HTTP clients.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


class ChannelKind(StrEnum):
    TELEGRAM = "telegram"
    BARK = "bark"
    WECOM = "wecom"
    FEISHU = "feishu"
    EMAIL = "email"
    PUSHDEER = "pushdeer"


class ChannelDirection(StrEnum):
    IN = "in"
    OUT = "out"


class ChannelMessageStatus(StrEnum):
    PENDING = "pending"
    DELIVERED = "delivered"
    FAILED = "failed"
    RECEIVED = "received"


NotificationSeverity = Literal["info", "warn", "P2", "P1", "P0"]


class NotificationAction(BaseModel):
    """Interactive hint attached to a notification.

    Adapters render these inline where supported (Telegram inline buttons,
    email links) and fall back to plain URLs otherwise.
    """

    label: str = Field(min_length=1, max_length=64)
    url: str | None = None
    command: str | None = None

    model_config = {"frozen": True}


class NotificationPayload(BaseModel):
    """Outbound message. ``body`` is markdown; adapters downgrade as needed."""

    title: str = Field(min_length=1, max_length=200)
    body: str = Field(default="", max_length=8000)
    severity: NotificationSeverity = "info"
    icon: str | None = Field(default=None, max_length=8)
    actions: list[NotificationAction] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)

    model_config = {"frozen": True}


class Channel(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    kind: ChannelKind
    display_name: str = Field(min_length=1, max_length=128)
    config: dict[str, Any] = Field(default_factory=dict)
    inbound_enabled: bool = False
    outbound_enabled: bool = True
    webhook_secret: str | None = None
    auto_approve_outbound: bool = False
    enabled: bool = True
    created_at: datetime
    updated_at: datetime

    model_config = {"frozen": True}


class ChannelSubscription(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    channel_id: str = Field(min_length=1, max_length=64)
    topic: str = Field(min_length=1, max_length=128)
    filter: dict[str, Any] | None = None
    enabled: bool = True
    created_at: datetime

    model_config = {"frozen": True}


class InboundMessage(BaseModel):
    """Parsed result from ``ChannelAdapter.parse_inbound``."""

    channel_id: str
    external_user_ref: str
    text: str
    received_at: datetime
    raw: dict[str, Any] = Field(default_factory=dict)

    model_config = {"frozen": True}


class ChannelMessage(BaseModel):
    id: str
    channel_id: str
    direction: ChannelDirection
    topic: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    conversation_id: str | None = None
    external_id: str | None = None
    external_user_ref: str | None = None
    status: ChannelMessageStatus = ChannelMessageStatus.PENDING
    error_message: str | None = None
    created_at: datetime

    model_config = {"frozen": True}


class DeliveryResult(BaseModel):
    channel_id: str
    status: ChannelMessageStatus
    external_id: str | None = None
    error_message: str | None = None
    elapsed_ms: int = 0

    model_config = {"frozen": True}


class ChannelTestResult(BaseModel):
    ok: bool
    latency_ms: int = 0
    detail: str = ""

    model_config = {"frozen": True}


__all__ = [
    "Channel",
    "ChannelDirection",
    "ChannelKind",
    "ChannelMessage",
    "ChannelMessageStatus",
    "ChannelSubscription",
    "ChannelTestResult",
    "DeliveryResult",
    "InboundMessage",
    "NotificationAction",
    "NotificationPayload",
    "NotificationSeverity",
]
