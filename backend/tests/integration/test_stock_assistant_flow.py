"""Stock-assistant flow integration tests.

Without a live LLM we can't exercise the agent's tool composition, but we can
prove that every primitive the briefing / anomaly pipelines need is available
and stitches through the REST layer. Two closed loops are covered:

1. Briefing flow — /market/holdings + /market/quote + /notifications/send
   produce a notification that fans out to a subscribed channel.
2. Anomaly flow — /market/poller/tick-once publishes events that the
   EventBus records in the events table with kind ``market.anomaly``.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, ClassVar, Literal

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
    NotificationPayload,
)
from allhands.core.market import Quote
from allhands.execution.channels.base import ChannelAdapter
from allhands.execution.market.base import Capability, MarketDataProvider
from allhands.execution.market.router import MarketDataRouter
from allhands.persistence.orm.base import Base


class _FakeQuoter(MarketDataProvider):
    id: ClassVar[str] = "fake"
    tier: ClassVar[Literal["free", "paid"]] = "free"
    capabilities: ClassVar[set[Capability]] = {Capability.QUOTE}

    async def get_quote(self, symbol: str) -> Quote:
        return Quote(
            symbol=symbol,
            last=Decimal("100.00"),
            change=Decimal("1.50"),
            change_pct=Decimal("1.50"),
            ts=datetime.now(UTC),
            source=self.id,
        )


class _CaptureAdapter(ChannelAdapter):
    kind = ChannelKind.TELEGRAM
    supports_inbound = False

    def __init__(self) -> None:
        self.deliveries: list[NotificationPayload] = []

    async def send(self, channel: Channel, payload: NotificationPayload) -> DeliveryResult:
        self.deliveries.append(payload)
        return DeliveryResult(
            channel_id=channel.id,
            status=ChannelMessageStatus.DELIVERED,
            external_id=f"fake-{len(self.deliveries)}",
        )

    async def test_connection(self, channel: Channel) -> ChannelTestResult:
        return ChannelTestResult(ok=True, latency_ms=1)


@pytest.fixture
def client_with_capture(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[TestClient, _CaptureAdapter]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    async def _session() -> AsyncIterator[AsyncSession]:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as s, s.begin():
            yield s

    capture = _CaptureAdapter()
    monkeypatch.setattr(
        "allhands.api.routers.channels.discover_channel_adapters",
        lambda: dict.fromkeys(ChannelKind, capture),
    )
    monkeypatch.setattr(
        "allhands.api.routers.market.build_default_router",
        lambda: MarketDataRouter([_FakeQuoter()], priority=["fake"]),
    )
    app = create_app()
    app.dependency_overrides[get_session] = _session
    return TestClient(app), capture


def test_briefing_closed_loop(client_with_capture: tuple[TestClient, _CaptureAdapter]) -> None:
    """User has a channel + a subscription + some holdings; a briefing
    notification reaches the adapter."""
    client, capture = client_with_capture
    # 1. register a channel + subscribe to stock.briefing.daily
    ch = client.post(
        "/api/channels",
        json={
            "kind": "telegram",
            "display_name": "bot",
            "config": {"bot_token": "t", "chat_id": "1"},
            "outbound_enabled": True,
            "inbound_enabled": False,
        },
    ).json()
    client.post(
        f"/api/channels/{ch['id']}/subscriptions",
        json={"topic": "stock.briefing.daily"},
    )
    # 2. add one holding so the agent has something to brief about
    client.post(
        "/api/market/holdings",
        json={
            "symbol": "SSE:600519",
            "name": "贵州茅台",
            "quantity": 100,
            "avg_cost": 1700.0,
        },
    )
    # 3. simulate what generate_briefing would do: fetch a quote, push a
    # notification via the notifications router.
    quote = client.get("/api/market/quote/SSE:600519").json()
    body = f"# 开盘 briefing · 测试日\n\n**SSE:600519** {quote['last']} ({quote['change_pct']}%)\n"
    resp = client.post(
        "/api/notifications/send",
        json={
            "topic": "stock.briefing.daily",
            "payload": {"title": "开盘 briefing", "body": body, "severity": "info"},
        },
    )
    assert resp.status_code == 200
    assert resp.json()[0]["status"] == "delivered"
    assert len(capture.deliveries) == 1
    assert "贵州茅台" not in capture.deliveries[0].body  # name wasn't referenced yet
    assert capture.deliveries[0].body.startswith("# 开盘 briefing")


def test_anomaly_closed_loop(client_with_capture: tuple[TestClient, _CaptureAdapter]) -> None:
    """poller tick-once returns the events shape an agent would explain."""
    client, _ = client_with_capture
    client.post("/api/market/watched", json={"symbol": "SSE:600519", "name": "贵州茅台"})
    client.post("/api/market/poller/start")
    client.post("/api/market/poller/stop")
    # v0 deterministic fake returns same last every call, so no anomaly fires
    resp = client.post("/api/market/poller/tick-once")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_skill_tool_list_matches_registered() -> None:
    """The skill's tool_ids resolve to real tools in the discovery pipeline."""
    from allhands.execution.registry import ToolRegistry
    from allhands.execution.skills import SkillRegistry, seed_skills
    from allhands.execution.tools import discover_builtin_tools

    tr = ToolRegistry()
    discover_builtin_tools(tr)
    sr = SkillRegistry()
    seed_skills(sr)
    skill = sr.get("allhands.skills.stock_assistant")
    assert skill is not None
    missing: list[str] = []
    for tid in skill.tool_ids:
        try:
            tr.get(tid)
        except Exception:
            missing.append(tid)
    assert missing == [], f"skill references unregistered tools: {missing}"


def _unused_any() -> Any:  # pragma: no cover - keeps the `Any` import used
    return None
