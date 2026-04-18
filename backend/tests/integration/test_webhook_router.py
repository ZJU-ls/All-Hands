"""Integration tests · POST /api/webhooks/{trigger_id}.

The webhook endpoint does not validate that the trigger exists; it only
publishes a webhook.external event tagged with trigger_id. The event
listener + EventPattern filter do the routing. Keeps the endpoint small
and defense rules centralized in the executor.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from allhands.api.routers.webhooks import MAX_WEBHOOK_BYTES
from allhands.api.routers.webhooks import router as webhooks_router
from allhands.execution.event_bus import EventBus


def _build_client_with_bus() -> tuple[TestClient, EventBus]:
    app = FastAPI()
    app.include_router(webhooks_router, prefix="/api")
    bus = EventBus()
    app.state.trigger_runtime = type("Runtime", (), {"bus": bus})()
    return TestClient(app), bus


def test_webhook_accepts_json_and_publishes_event() -> None:
    client, bus = _build_client_with_bus()
    published: list[tuple[str, dict[str, object]]] = []

    async def capture(env: object) -> None:
        from allhands.core import EventEnvelope

        assert isinstance(env, EventEnvelope)
        published.append((env.kind, dict(env.payload)))

    bus.subscribe_all(capture)

    resp = client.post("/api/webhooks/trg_1", json={"hello": "world"})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"status": "accepted", "trigger_id": "trg_1"}

    assert published, "no event published"
    kind, payload = published[0]
    assert kind == "webhook.external"
    assert payload == {"trigger_id": "trg_1", "body": {"hello": "world"}}


def test_webhook_accepts_non_json_body() -> None:
    client, _ = _build_client_with_bus()
    resp = client.post(
        "/api/webhooks/trg_2",
        content=b"hello text",
        headers={"content-type": "text/plain"},
    )
    assert resp.status_code == 200
    assert resp.json()["trigger_id"] == "trg_2"


def test_webhook_rejects_bad_json() -> None:
    client, _ = _build_client_with_bus()
    resp = client.post(
        "/api/webhooks/trg_3",
        content=b"{not valid json",
        headers={"content-type": "application/json"},
    )
    assert resp.status_code == 400


def test_webhook_rejects_oversized_body() -> None:
    client, _ = _build_client_with_bus()
    big = b"x" * (MAX_WEBHOOK_BYTES + 1)
    resp = client.post(
        "/api/webhooks/trg_4",
        content=big,
        headers={"content-type": "application/octet-stream"},
    )
    assert resp.status_code == 413


def test_webhook_503_when_runtime_missing() -> None:
    app = FastAPI()
    app.include_router(webhooks_router, prefix="/api")
    # no app.state.trigger_runtime
    client = TestClient(app)
    resp = client.post("/api/webhooks/trg_5", json={})
    assert resp.status_code == 503
