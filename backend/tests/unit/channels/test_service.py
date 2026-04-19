"""ChannelService unit tests — subscription fan-out + send_direct + audit."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from allhands.core.channel import (
    Channel,
    ChannelDirection,
    ChannelKind,
    ChannelMessage,
    ChannelMessageStatus,
    ChannelSubscription,
    ChannelTestResult,
    DeliveryResult,
    NotificationPayload,
)
from allhands.execution.channels.base import ChannelAdapter
from allhands.services.channel_service import (
    ChannelKindNotSupportedError,
    ChannelNotFoundError,
    ChannelService,
    ChannelSignatureError,
)


class _StubRepo:
    def __init__(self) -> None:
        self.channels: dict[str, Channel] = {}

    async def get(self, channel_id: str) -> Channel | None:
        return self.channels.get(channel_id)

    async def list_all(self, enabled_only: bool = False) -> list[Channel]:
        items = list(self.channels.values())
        if enabled_only:
            items = [c for c in items if c.enabled]
        return items

    async def upsert(self, channel: Channel) -> Channel:
        self.channels[channel.id] = channel
        return channel

    async def delete(self, channel_id: str) -> None:
        self.channels.pop(channel_id, None)


class _StubSubRepo:
    def __init__(self) -> None:
        self.subs: dict[str, ChannelSubscription] = {}

    async def get(self, subscription_id: str) -> ChannelSubscription | None:
        return self.subs.get(subscription_id)

    async def list_for_channel(self, channel_id: str) -> list[ChannelSubscription]:
        return [s for s in self.subs.values() if s.channel_id == channel_id]

    async def list_for_topic(self, topic: str) -> list[ChannelSubscription]:
        return [s for s in self.subs.values() if s.enabled and s.topic in {topic, "*"}]

    async def upsert(self, sub: ChannelSubscription) -> ChannelSubscription:
        self.subs[sub.id] = sub
        return sub

    async def delete(self, subscription_id: str) -> None:
        self.subs.pop(subscription_id, None)


class _StubMsgRepo:
    def __init__(self) -> None:
        self.messages: list[ChannelMessage] = []

    async def save(self, message: ChannelMessage) -> ChannelMessage:
        self.messages.append(message)
        return message

    async def list_for_channel(
        self,
        channel_id: str,
        *,
        limit: int = 100,
        direction: ChannelDirection | None = None,
    ) -> list[ChannelMessage]:
        matching = [m for m in self.messages if m.channel_id == channel_id]
        if direction is not None:
            matching = [m for m in matching if m.direction is direction]
        return matching[-limit:]

    async def find_conversation_for_inbound(
        self, channel_id: str, external_user_ref: str
    ) -> str | None:
        for msg in reversed(self.messages):
            if (
                msg.channel_id == channel_id
                and msg.external_user_ref == external_user_ref
                and msg.conversation_id is not None
            ):
                return msg.conversation_id
        return None

    async def update_status(
        self,
        message_id: str,
        status: ChannelMessageStatus,
        *,
        external_id: str | None = None,
        error_message: str | None = None,
    ) -> None:
        for i, msg in enumerate(self.messages):
            if msg.id == message_id:
                self.messages[i] = msg.model_copy(
                    update={
                        "status": status,
                        "external_id": external_id or msg.external_id,
                        "error_message": error_message or msg.error_message,
                    }
                )
                break


class _FakeAdapter(ChannelAdapter):
    kind = ChannelKind.TELEGRAM
    supports_inbound = True

    def __init__(self) -> None:
        self.send_calls: list[tuple[Channel, NotificationPayload]] = []
        self.next_result: DeliveryResult | None = None

    async def send(self, channel: Channel, payload: NotificationPayload) -> DeliveryResult:
        self.send_calls.append((channel, payload))
        return self.next_result or DeliveryResult(
            channel_id=channel.id,
            status=ChannelMessageStatus.DELIVERED,
            external_id="fake-id",
        )

    async def parse_inbound(
        self,
        channel: Channel,
        headers: dict[str, str],
        body: bytes,
    ) -> Any:
        import json

        from allhands.core.channel import InboundMessage

        data = json.loads(body)
        msg = data.get("message", {})
        return InboundMessage(
            channel_id=channel.id,
            external_user_ref=str(msg.get("chat", {}).get("id", "")),
            text=msg.get("text", ""),
            received_at=datetime.now(UTC),
            raw=data,
        )

    async def test_connection(self, channel: Channel) -> ChannelTestResult:
        return ChannelTestResult(ok=True, latency_ms=1)


def _mk_svc(
    *, inbound_handler: Any = None
) -> tuple[ChannelService, _StubRepo, _StubSubRepo, _StubMsgRepo, _FakeAdapter]:
    repo = _StubRepo()
    sub = _StubSubRepo()
    msg = _StubMsgRepo()
    adapter = _FakeAdapter()
    svc = ChannelService(
        channel_repo=repo,
        subscription_repo=sub,
        message_repo=msg,
        adapters={ChannelKind.TELEGRAM: adapter},
        inbound_handler=inbound_handler,
    )
    return svc, repo, sub, msg, adapter


@pytest.mark.asyncio
async def test_register_rejects_unknown_kind() -> None:
    svc, _, _, _, _ = _mk_svc()
    with pytest.raises(ChannelKindNotSupportedError):
        await svc.register(kind=ChannelKind.WECOM, display_name="nope", config={})


@pytest.mark.asyncio
async def test_register_and_list() -> None:
    svc, _, _, _, _ = _mk_svc()
    channel = await svc.register(
        kind=ChannelKind.TELEGRAM, display_name="bot", config={"bot_token": "t"}
    )
    listing = await svc.list_channels()
    assert [c.id for c in listing] == [channel.id]


@pytest.mark.asyncio
async def test_notify_fans_out_to_matching_subscriptions() -> None:
    svc, _, _, msg, adapter = _mk_svc()
    channel = await svc.register(
        kind=ChannelKind.TELEGRAM, display_name="bot", config={"bot_token": "t"}
    )
    await svc.add_subscription(channel.id, topic="stock.anomaly")
    results = await svc.notify(
        NotificationPayload(title="hi", severity="P0"),
        topic="stock.anomaly",
    )
    assert len(results) == 1
    assert results[0].status is ChannelMessageStatus.DELIVERED
    assert len(adapter.send_calls) == 1
    assert len([m for m in msg.messages if m.direction is ChannelDirection.OUT]) == 1


@pytest.mark.asyncio
async def test_notify_filters_by_severity() -> None:
    svc, _, _, _, adapter = _mk_svc()
    channel = await svc.register(
        kind=ChannelKind.TELEGRAM, display_name="bot", config={"bot_token": "t"}
    )
    await svc.add_subscription(channel.id, topic="stock.anomaly", filter={"severity": ["P0", "P1"]})
    await svc.notify(NotificationPayload(title="low", severity="info"), topic="stock.anomaly")
    assert adapter.send_calls == []
    await svc.notify(NotificationPayload(title="hi", severity="P0"), topic="stock.anomaly")
    assert len(adapter.send_calls) == 1


@pytest.mark.asyncio
async def test_notify_filters_by_symbol() -> None:
    svc, _, _, _, adapter = _mk_svc()
    channel = await svc.register(
        kind=ChannelKind.TELEGRAM, display_name="bot", config={"bot_token": "t"}
    )
    await svc.add_subscription(
        channel.id, topic="stock.anomaly", filter={"symbols": ["SSE:600519"]}
    )
    await svc.notify(
        NotificationPayload(title="other", meta={"symbol": "SSE:000001"}),
        topic="stock.anomaly",
    )
    assert adapter.send_calls == []
    await svc.notify(
        NotificationPayload(title="ours", meta={"symbol": "SSE:600519"}),
        topic="stock.anomaly",
    )
    assert len(adapter.send_calls) == 1


@pytest.mark.asyncio
async def test_get_missing_raises() -> None:
    svc, _, _, _, _ = _mk_svc()
    with pytest.raises(ChannelNotFoundError):
        await svc.get("missing")


@pytest.mark.asyncio
async def test_send_direct_records_out_message_on_failure() -> None:
    svc, _, _, msg, adapter = _mk_svc()
    channel = await svc.register(kind=ChannelKind.TELEGRAM, display_name="bot", config={})
    adapter.next_result = DeliveryResult(
        channel_id=channel.id,
        status=ChannelMessageStatus.FAILED,
        error_message="kaboom",
    )
    result = await svc.send_direct(channel.id, NotificationPayload(title="hi"))
    assert result.status is ChannelMessageStatus.FAILED
    assert msg.messages[0].status is ChannelMessageStatus.FAILED
    assert msg.messages[0].error_message == "kaboom"


@pytest.mark.asyncio
async def test_handle_inbound_requires_inbound_enabled() -> None:
    svc, _, _, _, _ = _mk_svc()
    channel = await svc.register(
        kind=ChannelKind.TELEGRAM,
        display_name="bot",
        config={"bot_token": "t", "chat_id": "1"},
        inbound_enabled=False,
    )
    with pytest.raises(ChannelSignatureError):
        await svc.handle_inbound(channel.id, {}, b'{"message":{"chat":{"id":1},"text":"x"}}')


@pytest.mark.asyncio
async def test_handle_inbound_calls_handler() -> None:
    captured: list[tuple[str, str]] = []

    async def _handler(inbound: Any, channel: Channel) -> str | None:
        captured.append((channel.id, inbound.text))
        return "conv_123"

    svc, _, _, msg, _ = _mk_svc(inbound_handler=_handler)
    channel = await svc.register(
        kind=ChannelKind.TELEGRAM,
        display_name="bot",
        config={"bot_token": "t", "chat_id": "1"},
        inbound_enabled=True,
    )
    body = b'{"message":{"chat":{"id":555},"text":"hey"}}'
    inbound = await svc.handle_inbound(channel.id, {}, body)
    assert inbound.text == "hey"
    assert captured == [(channel.id, "hey")]
    inbound_rows = [m for m in msg.messages if m.direction is ChannelDirection.IN]
    assert len(inbound_rows) == 1
    assert inbound_rows[0].conversation_id == "conv_123"


@pytest.mark.asyncio
async def test_default_signature_helper_matches_hmac() -> None:
    sig = ChannelService.compute_default_signature("key", b"body")
    # sanity: same input → same output
    assert sig == ChannelService.compute_default_signature("key", b"body")
    assert sig != ChannelService.compute_default_signature("key", b"different")


@pytest.mark.asyncio
async def test_update_partial_preserves_other_fields() -> None:
    svc, _, _, _, _ = _mk_svc()
    channel = await svc.register(
        kind=ChannelKind.TELEGRAM,
        display_name="bot",
        config={"bot_token": "t", "chat_id": "1"},
    )
    updated = await svc.update(channel.id, auto_approve_outbound=True)
    assert updated.auto_approve_outbound is True
    assert updated.display_name == channel.display_name
    assert updated.config == channel.config


@pytest.mark.asyncio
async def test_update_subscription_flow() -> None:
    svc, _, _, _, _ = _mk_svc()
    channel = await svc.register(kind=ChannelKind.TELEGRAM, display_name="bot", config={})
    sub = await svc.add_subscription(channel.id, topic="t.a")
    updated = await svc.update_subscription(sub.id, enabled=False)
    assert updated.enabled is False
    await svc.delete_subscription(sub.id)
    remaining = await svc.list_subscriptions(channel.id)
    assert remaining == []


@pytest.mark.asyncio
async def test_created_at_is_timezone_aware() -> None:
    svc, _, _, _, _ = _mk_svc()
    channel = await svc.register(kind=ChannelKind.TELEGRAM, display_name="bot", config={})
    # service-created objects must be tz-aware so ISO round-trips work
    assert channel.created_at.tzinfo is not None
    assert channel.created_at < datetime.now(UTC).replace(microsecond=999999)
