"""End-to-end tests for /api/triggers."""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from allhands.api import create_app
from allhands.api.deps import get_session, get_trigger_service
from allhands.core import TriggerAction, TriggerActionType
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlTriggerFireRepo, SqlTriggerRepo
from allhands.services.trigger_service import TriggerService


@pytest.fixture
def client() -> TestClient:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    async def _session() -> AsyncIterator[AsyncSession]:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as s:
            yield s

    async def _trigger_service(session: AsyncSession = Depends(_session)) -> TriggerService:
        async def _notify(action: TriggerAction, rendered: str, trigger_id: str) -> str | None:
            return None

        return TriggerService(
            trigger_repo=SqlTriggerRepo(session),
            fire_repo=SqlTriggerFireRepo(session),
            action_handlers={TriggerActionType.NOTIFY_USER: _notify},
        )

    app = create_app()
    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_trigger_service] = _trigger_service
    return TestClient(app)


def test_list_empty(client: TestClient) -> None:
    resp = client.get("/api/triggers")
    assert resp.status_code == 200
    assert resp.json() == []


def test_create_timer_trigger(client: TestClient) -> None:
    body = {
        "name": "daily digest",
        "kind": "timer",
        "timer": {"cron": "0 8 * * *"},
        "action": {"type": "notify_user", "channel": "cockpit", "message": "hello"},
    }
    resp = client.post("/api/triggers", json=body)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["name"] == "daily digest"
    assert data["kind"] == "timer"
    assert data["enabled"] is True
    assert data["min_interval_seconds"] == 300


def test_create_event_trigger(client: TestClient) -> None:
    body = {
        "name": "changelog watcher",
        "kind": "event",
        "event": {
            "type": "artifact.updated",
            "filter": {"name_pattern": "**/CHANGELOG*"},
        },
        "action": {
            "type": "dispatch_employee",
            "employee_id": "emp_1",
            "task_template": "summarize the update",
        },
    }
    resp = client.post("/api/triggers", json=body)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["event"]["type"] == "artifact.updated"


def test_create_rejects_timer_without_spec(client: TestClient) -> None:
    body = {
        "name": "bad",
        "kind": "timer",
        "action": {"type": "notify_user", "message": "x"},
    }
    resp = client.post("/api/triggers", json=body)
    assert resp.status_code == 422


def test_create_rejects_min_interval_below_60(client: TestClient) -> None:
    body = {
        "name": "too fast",
        "kind": "timer",
        "timer": {"cron": "* * * * *"},
        "action": {"type": "notify_user", "message": "x"},
        "min_interval_seconds": 30,
    }
    resp = client.post("/api/triggers", json=body)
    assert resp.status_code == 422


def test_get_missing_returns_404(client: TestClient) -> None:
    resp = client.get("/api/triggers/nope")
    assert resp.status_code == 404


def test_patch_rename(client: TestClient) -> None:
    body = {
        "name": "a",
        "kind": "timer",
        "timer": {"cron": "* * * * *"},
        "action": {"type": "notify_user", "message": "m"},
    }
    created = client.post("/api/triggers", json=body).json()
    resp = client.patch(f"/api/triggers/{created['id']}", json={"name": "renamed"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "renamed"


def test_toggle(client: TestClient) -> None:
    body = {
        "name": "t",
        "kind": "timer",
        "timer": {"cron": "* * * * *"},
        "action": {"type": "notify_user", "message": "m"},
    }
    created = client.post("/api/triggers", json=body).json()
    r1 = client.post(f"/api/triggers/{created['id']}/toggle", json={"enabled": False})
    assert r1.json()["enabled"] is False
    r2 = client.post(f"/api/triggers/{created['id']}/toggle", json={"enabled": True})
    assert r2.json()["enabled"] is True


def test_fire_and_list_fires(client: TestClient) -> None:
    body = {
        "name": "t",
        "kind": "timer",
        "timer": {"cron": "* * * * *"},
        "action": {"type": "notify_user", "channel": "cockpit", "message": "m"},
    }
    created = client.post("/api/triggers", json=body).json()
    fire_resp = client.post(f"/api/triggers/{created['id']}/fire")
    assert fire_resp.status_code == 200
    fire = fire_resp.json()
    assert fire["source"] == "manual"
    assert fire["status"] == "dispatched"

    history = client.get(f"/api/triggers/{created['id']}/fires").json()
    assert len(history) >= 1


def test_delete(client: TestClient) -> None:
    body = {
        "name": "t",
        "kind": "timer",
        "timer": {"cron": "* * * * *"},
        "action": {"type": "notify_user", "message": "m"},
    }
    created = client.post("/api/triggers", json=body).json()
    resp = client.delete(f"/api/triggers/{created['id']}")
    assert resp.status_code == 204
    assert client.get(f"/api/triggers/{created['id']}").status_code == 404
