"""Channel REST endpoints — spec § 5.2.

All write endpoints have a paired Meta Tool in
``execution/tools/meta/channel_tools.py`` (L01 Tool First).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import (
    AsyncSession,  # noqa: TC002 — FastAPI runtime dependency resolution
)

from allhands.api.deps import get_session
from allhands.core.channel import (
    Channel,
    ChannelDirection,
    ChannelKind,
    ChannelMessage,
    ChannelSubscription,
    ChannelTestResult,
    DeliveryResult,
    NotificationAction,
    NotificationPayload,
)
from allhands.execution.channels import discover_channel_adapters
from allhands.execution.channels.base import (
    ChannelAdapterError,
    ChannelAdapterInboundNotSupported,
)
from allhands.persistence.channel_repos import (
    SqlChannelMessageRepo,
    SqlChannelRepo,
    SqlChannelSubscriptionRepo,
)
from allhands.services.channel_service import (
    ChannelKindNotSupportedError,
    ChannelNotFoundError,
    ChannelService,
    ChannelSignatureError,
)

router = APIRouter(prefix="/channels", tags=["channels"])
notifications_router = APIRouter(prefix="/notifications", tags=["notifications"])


def _build_channel_service(
    session: AsyncSession,
    *,
    with_inbound_handler: bool = False,
) -> ChannelService:
    """Construct a request-scoped ChannelService.

    ``with_inbound_handler`` is set only on the webhook endpoint so REST CRUD
    does not drag the ChatService dependency tree into every call.
    """
    channel_repo = SqlChannelRepo(session)
    sub_repo = SqlChannelSubscriptionRepo(session)
    msg_repo = SqlChannelMessageRepo(session)
    inbound_handler = None
    if with_inbound_handler:
        from allhands.api.deps import get_chat_service
        from allhands.persistence.sql_repos import (
            SqlConversationRepo,
            SqlEmployeeRepo,
        )
        from allhands.services.channel_inbound import build_inbound_handler

        # Lazy chat-service construction to avoid importing chat-service in
        # CRUD paths that don't need it.
        async def _build_handler_once(svc: ChannelService) -> None:
            chat_service = await get_chat_service(session)
            svc._inbound_handler = build_inbound_handler(
                chat_service=chat_service,
                conversations=SqlConversationRepo(session),
                employees=SqlEmployeeRepo(session),
                messages_repo=msg_repo,
            )

        inbound_handler = _build_handler_once  # marker, resolved below
    service = ChannelService(
        channel_repo=channel_repo,
        subscription_repo=sub_repo,
        message_repo=msg_repo,
        adapters=discover_channel_adapters(),
    )
    if with_inbound_handler and inbound_handler is not None:
        # Run the async closure synchronously-ish via a pending task; the
        # webhook handler awaits the service anyway so the ordering is safe.
        service._pending_handler_setup = inbound_handler  # type: ignore[attr-defined]
    return service


async def _get_channel_service(
    session: AsyncSession = Depends(get_session),
) -> ChannelService:
    return _build_channel_service(session)


async def _get_channel_service_with_inbound(
    session: AsyncSession = Depends(get_session),
) -> ChannelService:
    svc = _build_channel_service(session, with_inbound_handler=True)
    setup = getattr(svc, "_pending_handler_setup", None)
    if setup is not None:
        await setup(svc)
    return svc


# -- request/response models -------------------------------------------


class RegisterChannelRequest(BaseModel):
    kind: ChannelKind
    display_name: str = Field(min_length=1, max_length=128)
    config: dict[str, Any] = Field(default_factory=dict)
    inbound_enabled: bool = False
    outbound_enabled: bool = True
    auto_approve_outbound: bool = False
    webhook_secret: str | None = None


class UpdateChannelRequest(BaseModel):
    display_name: str | None = None
    config: dict[str, Any] | None = None
    inbound_enabled: bool | None = None
    outbound_enabled: bool | None = None
    auto_approve_outbound: bool | None = None
    webhook_secret: str | None = None
    enabled: bool | None = None


class ChannelResponse(BaseModel):
    id: str
    kind: ChannelKind
    display_name: str
    config: dict[str, Any]
    inbound_enabled: bool
    outbound_enabled: bool
    auto_approve_outbound: bool
    webhook_secret: str | None
    enabled: bool
    created_at: str
    updated_at: str

    @classmethod
    def from_domain(cls, channel: Channel) -> ChannelResponse:
        return cls(
            id=channel.id,
            kind=channel.kind,
            display_name=channel.display_name,
            config=dict(channel.config),
            inbound_enabled=channel.inbound_enabled,
            outbound_enabled=channel.outbound_enabled,
            auto_approve_outbound=channel.auto_approve_outbound,
            webhook_secret=channel.webhook_secret,
            enabled=channel.enabled,
            created_at=channel.created_at.isoformat(),
            updated_at=channel.updated_at.isoformat(),
        )


class SubscriptionBody(BaseModel):
    topic: str = Field(min_length=1, max_length=128)
    filter: dict[str, Any] | None = None


class SubscriptionResponse(BaseModel):
    id: str
    channel_id: str
    topic: str
    filter: dict[str, Any] | None
    enabled: bool
    created_at: str

    @classmethod
    def from_domain(cls, sub: ChannelSubscription) -> SubscriptionResponse:
        return cls(
            id=sub.id,
            channel_id=sub.channel_id,
            topic=sub.topic,
            filter=dict(sub.filter) if sub.filter else None,
            enabled=sub.enabled,
            created_at=sub.created_at.isoformat(),
        )


class NotificationActionBody(BaseModel):
    label: str
    url: str | None = None
    command: str | None = None


class NotificationPayloadBody(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = ""
    severity: str = "info"
    icon: str | None = None
    actions: list[NotificationActionBody] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)


class SendNotificationRequest(BaseModel):
    topic: str
    payload: NotificationPayloadBody
    channel_ids: list[str] | None = None
    conversation_id: str | None = None


class DeliveryResultBody(BaseModel):
    channel_id: str
    status: str
    external_id: str | None
    error_message: str | None
    elapsed_ms: int


def _delivery_to_body(result: DeliveryResult) -> DeliveryResultBody:
    return DeliveryResultBody(
        channel_id=result.channel_id,
        status=result.status.value,
        external_id=result.external_id,
        error_message=result.error_message,
        elapsed_ms=result.elapsed_ms,
    )


def _payload_to_domain(body: NotificationPayloadBody) -> NotificationPayload:
    return NotificationPayload(
        title=body.title,
        body=body.body,
        severity=body.severity,  # type: ignore[arg-type]
        icon=body.icon,
        actions=[
            NotificationAction(label=a.label, url=a.url, command=a.command) for a in body.actions
        ],
        meta=dict(body.meta),
    )


class MessageResponse(BaseModel):
    id: str
    channel_id: str
    direction: str
    topic: str | None
    payload: dict[str, Any]
    conversation_id: str | None
    external_id: str | None
    external_user_ref: str | None
    status: str
    error_message: str | None
    created_at: str

    @classmethod
    def from_domain(cls, msg: ChannelMessage) -> MessageResponse:
        return cls(
            id=msg.id,
            channel_id=msg.channel_id,
            direction=msg.direction.value,
            topic=msg.topic,
            payload=dict(msg.payload),
            conversation_id=msg.conversation_id,
            external_id=msg.external_id,
            external_user_ref=msg.external_user_ref,
            status=msg.status.value,
            error_message=msg.error_message,
            created_at=msg.created_at.isoformat(),
        )


class TestResultResponse(BaseModel):
    ok: bool
    latency_ms: int
    detail: str

    @classmethod
    def from_domain(cls, r: ChannelTestResult) -> TestResultResponse:
        return cls(ok=r.ok, latency_ms=r.latency_ms, detail=r.detail)


# -- routes: channels ---------------------------------------------------


@router.get("", response_model=list[ChannelResponse])
async def list_channels(
    enabled_only: bool = False,
    service: ChannelService = Depends(_get_channel_service),
) -> list[ChannelResponse]:
    items = await service.list_channels(enabled_only=enabled_only)
    return [ChannelResponse.from_domain(c) for c in items]


@router.post("", response_model=ChannelResponse, status_code=201)
async def register_channel(
    body: RegisterChannelRequest,
    service: ChannelService = Depends(_get_channel_service),
) -> ChannelResponse:
    try:
        channel = await service.register(
            kind=body.kind,
            display_name=body.display_name,
            config=body.config,
            inbound_enabled=body.inbound_enabled,
            outbound_enabled=body.outbound_enabled,
            auto_approve_outbound=body.auto_approve_outbound,
            webhook_secret=body.webhook_secret,
        )
    except ChannelKindNotSupportedError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ChannelResponse.from_domain(channel)


@router.get("/{channel_id}", response_model=ChannelResponse)
async def get_channel(
    channel_id: str,
    service: ChannelService = Depends(_get_channel_service),
) -> ChannelResponse:
    try:
        channel = await service.get(channel_id)
    except ChannelNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ChannelResponse.from_domain(channel)


@router.patch("/{channel_id}", response_model=ChannelResponse)
async def update_channel(
    channel_id: str,
    body: UpdateChannelRequest,
    service: ChannelService = Depends(_get_channel_service),
) -> ChannelResponse:
    try:
        channel = await service.update(
            channel_id,
            display_name=body.display_name,
            config=body.config,
            inbound_enabled=body.inbound_enabled,
            outbound_enabled=body.outbound_enabled,
            auto_approve_outbound=body.auto_approve_outbound,
            webhook_secret=body.webhook_secret,
            enabled=body.enabled,
        )
    except ChannelNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ChannelResponse.from_domain(channel)


@router.delete("/{channel_id}", status_code=204)
async def delete_channel(
    channel_id: str,
    service: ChannelService = Depends(_get_channel_service),
) -> None:
    try:
        await service.get(channel_id)
    except ChannelNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await service.delete(channel_id)


@router.post("/{channel_id}/test", response_model=TestResultResponse)
async def test_channel(
    channel_id: str,
    service: ChannelService = Depends(_get_channel_service),
) -> TestResultResponse:
    try:
        result = await service.test(channel_id)
    except ChannelNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return TestResultResponse.from_domain(result)


@router.post("/{channel_id}/webhook", status_code=200)
async def channel_webhook(
    channel_id: str,
    request: Request,
    service: ChannelService = Depends(_get_channel_service_with_inbound),
) -> dict[str, str]:
    body = await request.body()
    headers = {k.lower(): v for k, v in request.headers.items()}
    try:
        inbound = await service.handle_inbound(channel_id, headers, body)
    except ChannelNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ChannelSignatureError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except ChannelAdapterInboundNotSupported as exc:
        raise HTTPException(status_code=405, detail=str(exc)) from exc
    except ChannelAdapterError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": "true", "received_from": inbound.external_user_ref}


@router.get("/{channel_id}/messages", response_model=list[MessageResponse])
async def list_messages(
    channel_id: str,
    limit: int = 50,
    direction: str | None = None,
    service: ChannelService = Depends(_get_channel_service),
) -> list[MessageResponse]:
    dir_enum = ChannelDirection(direction) if direction else None
    try:
        items = await service.list_messages(channel_id, limit=limit, direction=dir_enum)
    except ChannelNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return [MessageResponse.from_domain(m) for m in items]


# -- routes: subscriptions ---------------------------------------------


@router.get("/{channel_id}/subscriptions", response_model=list[SubscriptionResponse])
async def list_subscriptions(
    channel_id: str,
    service: ChannelService = Depends(_get_channel_service),
) -> list[SubscriptionResponse]:
    try:
        items = await service.list_subscriptions(channel_id)
    except ChannelNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return [SubscriptionResponse.from_domain(s) for s in items]


@router.post("/{channel_id}/subscriptions", response_model=SubscriptionResponse, status_code=201)
async def add_subscription(
    channel_id: str,
    body: SubscriptionBody,
    service: ChannelService = Depends(_get_channel_service),
) -> SubscriptionResponse:
    try:
        sub = await service.add_subscription(channel_id, topic=body.topic, filter=body.filter)
    except ChannelNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return SubscriptionResponse.from_domain(sub)


@router.delete("/subscriptions/{subscription_id}", status_code=204)
async def delete_subscription(
    subscription_id: str,
    service: ChannelService = Depends(_get_channel_service),
) -> None:
    await service.delete_subscription(subscription_id)


# -- notifications -----------------------------------------------------


@notifications_router.post("/send", response_model=list[DeliveryResultBody])
async def send_notification(
    body: SendNotificationRequest,
    service: ChannelService = Depends(_get_channel_service),
) -> list[DeliveryResultBody]:
    payload = _payload_to_domain(body.payload)
    results = await service.notify(
        payload,
        body.topic,
        channel_ids=body.channel_ids,
        conversation_id=body.conversation_id,
    )
    return [_delivery_to_body(r) for r in results]


__all__ = ["notifications_router", "router"]
