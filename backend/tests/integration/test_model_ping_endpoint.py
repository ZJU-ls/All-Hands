"""Integration tests for POST /api/models/{id}/ping (I-0019 · 第一性原理重构).

Two-layer ping. Returns:

  {
    "endpoint":     {reachable, auth_ok, status_code, latency_ms, error_kind, error},
    "model_probe":  {usable, classification, status_code, latency_ms, error},
    "status":       "ok" | "degraded" | "endpoint_unreachable" | "auth_failed" | "model_unavailable",
    "ok":           bool,           # legacy
    "model":        str,
    "latency_ms":   int,            # legacy
    "error":        str | None,     # legacy
    "error_category": str | None,   # legacy
  }

The route composes `services.connectivity.probe_endpoint` and `probe_model`.
We monkeypatch those directly — the probes themselves have unit coverage in
`tests/unit/test_connectivity.py`.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from allhands.api import create_app
from allhands.api.deps import get_session
from allhands.core.model import LLMModel
from allhands.core.provider import LLMProvider
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlLLMModelRepo, SqlLLMProviderRepo
from allhands.services.connectivity import EndpointProbe, ModelProbe


@pytest.fixture
def seeded_client(monkeypatch: pytest.MonkeyPatch) -> tuple[TestClient, str, str]:
    """Spin up an in-memory app + one provider + one model. Return (client, provider_id, model_id)."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    provider_id = str(uuid.uuid4())
    model_id = str(uuid.uuid4())

    async def _session() -> AsyncIterator[AsyncSession]:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as s, s.begin():
            yield s

    async def _seed() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as s, s.begin():
            p_repo = SqlLLMProviderRepo(s)
            m_repo = SqlLLMModelRepo(s)
            await p_repo.upsert(
                LLMProvider(
                    id=provider_id,
                    name="TestProvider",
                    base_url="https://api.example.com/v1",
                    api_key="sk-fake",
                )
            )
            await m_repo.upsert(
                LLMModel(
                    id=model_id,
                    provider_id=provider_id,
                    name="gpt-4o-mini",
                    display_name="GPT-4o Mini",
                    context_window=128000,
                )
            )

    asyncio.run(_seed())

    app = create_app()
    app.dependency_overrides[get_session] = _session
    return TestClient(app), provider_id, model_id


def _patch_probes(
    monkeypatch: pytest.MonkeyPatch,
    *,
    endpoint: EndpointProbe,
    model: ModelProbe,
) -> dict[str, int]:
    """Install canned probe responses; return a counter of how many were called.

    The route is supposed to skip the model probe when the endpoint says
    unreachable / auth-failed — tests rely on the counter to assert that.
    """
    calls = {"endpoint": 0, "model": 0}

    async def _fake_endpoint(provider: LLMProvider, **_kw: Any) -> EndpointProbe:
        calls["endpoint"] += 1
        return endpoint

    async def _fake_model(provider: LLMProvider, model_name: str, **_kw: Any) -> ModelProbe:
        calls["model"] += 1
        return model

    monkeypatch.setattr("allhands.api.routers.models.probe_endpoint", _fake_endpoint)
    monkeypatch.setattr("allhands.api.routers.models.probe_model", _fake_model)
    return calls


def test_ping_ok_when_endpoint_and_model_both_healthy(
    seeded_client: tuple[TestClient, str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Healthy endpoint + healthy model = status:"ok", legacy ok=True."""
    client, _pid, mid = seeded_client
    _patch_probes(
        monkeypatch,
        endpoint=EndpointProbe(
            reachable=True, auth_ok=True, status_code=200, latency_ms=120, error_kind="ok"
        ),
        model=ModelProbe(usable=True, classification="ok", status_code=200, latency_ms=850),
    )

    r = client.post(f"/api/models/{mid}/ping")
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["status"] == "ok"
    assert body["ok"] is True
    assert body["model"] == "gpt-4o-mini"
    assert body["endpoint"]["reachable"] is True
    assert body["endpoint"]["auth_ok"] is True
    assert body["model_probe"]["usable"] is True
    assert body["model_probe"]["classification"] == "ok"


def test_ping_endpoint_unreachable_skips_model_probe(
    seeded_client: tuple[TestClient, str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If we can't even reach the host, don't double the wait by also running
    the 12s model probe — the user sees status:"endpoint_unreachable" fast."""
    client, _pid, mid = seeded_client
    calls = _patch_probes(
        monkeypatch,
        endpoint=EndpointProbe(
            reachable=False,
            auth_ok=None,
            status_code=None,
            latency_ms=8000,
            error_kind="network",
            error="ConnectError: Name resolution failed",
        ),
        model=ModelProbe(  # would never be reached
            usable=True, classification="ok", status_code=200, latency_ms=1
        ),
    )

    r = client.post(f"/api/models/{mid}/ping")
    body = r.json()

    assert body["status"] == "endpoint_unreachable"
    assert body["ok"] is False
    assert body["error_category"] == "connection"
    assert body["model_probe"]["usable"] is False
    # Crucial: model probe was NOT called — that's the whole point of the short-circuit.
    assert calls["model"] == 0
    assert calls["endpoint"] == 1


def test_ping_auth_failed_at_endpoint_layer(
    seeded_client: tuple[TestClient, str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """401 on /v1/models is the canonical 'wrong API key' signal — surface
    auth_failed and skip model probe."""
    client, _pid, mid = seeded_client
    calls = _patch_probes(
        monkeypatch,
        endpoint=EndpointProbe(
            reachable=True, auth_ok=False, status_code=401, latency_ms=110, error_kind="auth"
        ),
        model=ModelProbe(usable=True, classification="ok", status_code=200, latency_ms=1),
    )

    r = client.post(f"/api/models/{mid}/ping")
    body = r.json()

    assert body["status"] == "auth_failed"
    assert body["ok"] is False
    assert body["error_category"] == "auth"
    assert calls["model"] == 0


def test_ping_endpoint_ok_but_model_400_still_counts_as_connected(
    seeded_client: tuple[TestClient, str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """First-principles whitelist: 400 from the model means the server
    processed our payload — the model is reachable, just complained about
    something. status must be 'ok' (or 'degraded'), NOT 'model_unavailable'.

    This is the exact regression Qwen-thinking / MiniMax taught us — vendor
    body validation must not poison connectivity classification.
    """
    client, _pid, mid = seeded_client
    _patch_probes(
        monkeypatch,
        endpoint=EndpointProbe(
            reachable=True, auth_ok=True, status_code=200, latency_ms=120, error_kind="ok"
        ),
        model=ModelProbe(
            usable=True,  # whitelist: 400 stays usable
            classification="param_error",
            status_code=400,
            latency_ms=300,
            error="HTTP 400: enable_thinking is not a recognized parameter",
        ),
    )

    r = client.post(f"/api/models/{mid}/ping")
    body = r.json()

    # 400 is "connected, just rejected this specific call" — not "down"
    assert body["status"] == "ok"
    assert body["ok"] is True
    assert body["model_probe"]["status_code"] == 400
    assert body["model_probe"]["classification"] == "param_error"


def test_ping_endpoint_ok_but_model_404_marks_model_unavailable(
    seeded_client: tuple[TestClient, str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """404 with `model` in the body = the model name is not registered on
    that provider. THIS particular (provider, model) is unusable even
    though the endpoint itself is healthy."""
    client, _pid, mid = seeded_client
    _patch_probes(
        monkeypatch,
        endpoint=EndpointProbe(
            reachable=True, auth_ok=True, status_code=200, latency_ms=120, error_kind="ok"
        ),
        model=ModelProbe(
            usable=False,
            classification="model_not_found",
            status_code=404,
            latency_ms=200,
            error="HTTP 404: model not found",
        ),
    )

    r = client.post(f"/api/models/{mid}/ping")
    body = r.json()

    assert body["status"] == "model_unavailable"
    assert body["ok"] is False
    assert body["error_category"] == "model_not_found"


def test_ping_slow_model_marks_degraded(
    seeded_client: tuple[TestClient, str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A model that responds successfully but slowly (>5s) is connected,
    just warning the user that real chat will be sluggish — status:'degraded'."""
    client, _pid, mid = seeded_client
    _patch_probes(
        monkeypatch,
        endpoint=EndpointProbe(
            reachable=True, auth_ok=True, status_code=200, latency_ms=120, error_kind="ok"
        ),
        model=ModelProbe(usable=True, classification="ok", status_code=200, latency_ms=8200),
    )

    r = client.post(f"/api/models/{mid}/ping")
    body = r.json()

    assert body["status"] == "degraded"
    assert body["ok"] is True  # legacy: degraded still counts as connected


def test_ping_returns_404_when_model_missing(
    seeded_client: tuple[TestClient, str, str],
) -> None:
    """A non-existent model id is a route-level 404, not a probe failure."""
    client, _pid, _mid = seeded_client
    r = client.post(f"/api/models/{uuid.uuid4()}/ping")
    assert r.status_code == 404


def test_ping_response_is_json_not_stream(
    seeded_client: tuple[TestClient, str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Ping is single-shot JSON — never an SSE stream."""
    client, _pid, mid = seeded_client
    _patch_probes(
        monkeypatch,
        endpoint=EndpointProbe(
            reachable=True, auth_ok=True, status_code=200, latency_ms=10, error_kind="ok"
        ),
        model=ModelProbe(usable=True, classification="ok", status_code=200, latency_ms=10),
    )
    r = client.post(f"/api/models/{mid}/ping")
    assert r.headers["content-type"].startswith("application/json")
    assert isinstance(r.json(), dict)
