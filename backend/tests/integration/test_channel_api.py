"""End-to-end tests for /api/channels and /api/notifications.

Covers the full REST surface from spec § 5.2 using an in-memory SQLite engine
and a fake adapter substituted via the discover function (monkeypatched).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from allhands.api import create_app
from allhands.api.deps import get_session
from allhands.core.channel import (
    Channel,
    ChannelKind,
    ChannelMessageStatus,
    ChannelTestResult,
    DeliveryResult,
    InboundMessage,
    NotificationPayload,
)
from allhands.execution.channels.base import ChannelAdapter
from allhands.persistence.orm.base import Base


class _FakeAdapter(ChannelAdapter):
    kind = ChannelKind.TELEGRAM
    supports_inbound = True

    async def send(self, channel: Channel, payload: NotificationPayload) -> DeliveryResult:
        return DeliveryResult(
            channel_id=channel.id,
            status=ChannelMessageStatus.DELIVERED,
            external_id="fake-id",
            elapsed_ms=1,
        )

    async def parse_inbound(
        self,
        channel: Channel,
        headers: dict[str, str],
        body: bytes,
    ) -> InboundMessage:
        import json

        data = json.loads(body or b"{}")
        return InboundMessage(
            channel_id=channel.id,
            external_user_ref=str(data.get("user", "u1")),
            text=str(data.get("text", "")),
            received_at=datetime.now(UTC),
            raw=data,
        )

    async def test_connection(self, channel: Channel) -> ChannelTestResult:
        return ChannelTestResult(ok=True, latency_ms=1)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    async def _session() -> AsyncIterator[AsyncSession]:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as s, s.begin():
            yield s

    adapters: dict[ChannelKind, ChannelAdapter] = {k: _FakeAdapter() for k in ChannelKind}
    # Force the in-router factory to use fake adapters for every kind
    monkeypatch.setattr(
        "allhands.api.routers.channels.discover_channel_adapters",
        lambda: adapters,
    )
    app = create_app()
    app.dependency_overrides[get_session] = _session
    return TestClient(app)


def _register(client: TestClient, **overrides: Any) -> dict[str, Any]:
    body = {
        "kind": "telegram",
        "display_name": "bot",
        "config": {"bot_token": "t", "chat_id": "1"},
        "inbound_enabled": True,
        "outbound_enabled": True,
        "webhook_secret": "",
    }
    body.update(overrides)
    resp = client.post("/api/channels", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_list_empty(client: TestClient) -> None:
    resp = client.get("/api/channels")
    assert resp.status_code == 200
    assert resp.json() == []


def test_register_and_get(client: TestClient) -> None:
    ch = _register(client)
    resp = client.get(f"/api/channels/{ch['id']}")
    assert resp.status_code == 200
    assert resp.json()["display_name"] == "bot"


def test_register_rejects_unknown_kind(client: TestClient) -> None:
    resp = client.post(
        "/api/channels",
        json={"kind": "totally-not-real", "display_name": "x", "config": {}},
    )
    assert resp.status_code == 422


def test_patch_updates_auto_approve(client: TestClient) -> None:
    ch = _register(client, auto_approve_outbound=False)
    resp = client.patch(
        f"/api/channels/{ch['id']}",
        json={"auto_approve_outbound": True},
    )
    assert resp.status_code == 200
    assert resp.json()["auto_approve_outbound"] is True


def test_delete_removes_channel(client: TestClient) -> None:
    ch = _register(client)
    resp = client.delete(f"/api/channels/{ch['id']}")
    assert resp.status_code == 204
    assert client.get(f"/api/channels/{ch['id']}").status_code == 404


def test_test_endpoint_probes_adapter(client: TestClient) -> None:
    ch = _register(client)
    resp = client.post(f"/api/channels/{ch['id']}/test")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_subscription_lifecycle(client: TestClient) -> None:
    ch = _register(client)
    # add
    resp = client.post(
        f"/api/channels/{ch['id']}/subscriptions",
        json={"topic": "stock.anomaly", "filter": {"severity": ["P0"]}},
    )
    assert resp.status_code == 201
    sub_id = resp.json()["id"]
    # list
    subs = client.get(f"/api/channels/{ch['id']}/subscriptions").json()
    assert len(subs) == 1
    # delete
    assert client.delete(f"/api/channels/subscriptions/{sub_id}").status_code == 204


def test_send_notification_fan_out_by_topic(client: TestClient) -> None:
    ch = _register(client)
    client.post(
        f"/api/channels/{ch['id']}/subscriptions",
        json={"topic": "stock.briefing.daily"},
    )
    resp = client.post(
        "/api/notifications/send",
        json={
            "topic": "stock.briefing.daily",
            "payload": {"title": "开盘前 briefing", "body": "..."},
        },
    )
    assert resp.status_code == 200
    results = resp.json()
    assert len(results) == 1
    assert results[0]["status"] == "delivered"


def test_send_notification_with_explicit_channel_ids(client: TestClient) -> None:
    ch = _register(client)
    resp = client.post(
        "/api/notifications/send",
        json={
            "topic": "direct.test",
            "payload": {"title": "direct"},
            "channel_ids": [ch["id"]],
        },
    )
    assert resp.status_code == 200
    assert resp.json()[0]["status"] == "delivered"


def test_webhook_requires_inbound_enabled(client: TestClient) -> None:
    ch = _register(client, inbound_enabled=False)
    resp = client.post(
        f"/api/channels/{ch['id']}/webhook",
        json={"user": "u1", "text": "hi"},
    )
    assert resp.status_code == 401


def test_webhook_records_inbound_message(client: TestClient) -> None:
    ch = _register(client, inbound_enabled=True)
    resp = client.post(
        f"/api/channels/{ch['id']}/webhook",
        json={"user": "user-42", "text": "why did it drop"},
    )
    assert resp.status_code == 200
    messages = client.get(f"/api/channels/{ch['id']}/messages", params={"direction": "in"}).json()
    assert len(messages) == 1
    assert messages[0]["payload"]["text"] == "why did it drop"
    assert messages[0]["status"] == "received"
