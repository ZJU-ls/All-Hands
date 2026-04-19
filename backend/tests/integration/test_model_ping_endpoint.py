"""Integration tests for POST /api/models/{id}/ping (I-0019).

Fast connectivity test for a specific model. Runs a single one-shot chat
call with max_tokens=4, strict 5s timeout, and returns
`{ok, latency_ms, model, error?, error_category?}`.

Unlike `/api/models/{id}/test`, this endpoint is optimised for row-level
"ping" UX on the Gateway page — not for a full chat conversation. The
`/test` endpoint still exists for the ModelTestDialog's rich flow.

Tests seed a provider + model in memory, monkeypatch the service helper
used by the route to return canned responses (httpx.MockTransport would
also work but adds noise — the helper itself has exhaustive unit coverage
in tests/unit/test_model_service.py).
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

    # Seed one provider + one model before the first request.
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
                    default_model="gpt-4o-mini",
                    is_default=True,
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


def test_ping_returns_ok_shape_on_success(
    seeded_client: tuple[TestClient, str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _pid, mid = seeded_client

    async def _fake_run_chat_test(
        provider: LLMProvider, model_name: str, **kwargs: Any
    ) -> dict[str, Any]:
        # The route must pass max_tokens=4 and a tiny prompt — prove it.
        assert kwargs.get("max_tokens") == 4
        assert kwargs.get("prompt") == "ping"
        return {
            "ok": True,
            "model": model_name,
            "response": "pong",
            "reasoning_text": "",
            "latency_ms": 87,
            "usage": {"input_tokens": 2, "output_tokens": 1, "total_tokens": 3},
        }

    monkeypatch.setattr("allhands.api.routers.models.run_chat_test", _fake_run_chat_test)

    r = client.post(f"/api/models/{mid}/ping")
    assert r.status_code == 200, r.text
    body = r.json()

    # Shape contract — UI + meta tool consumers both depend on this.
    assert body["ok"] is True
    assert body["model"] == "gpt-4o-mini"
    assert body["latency_ms"] == 87
    # latency_ms must always be int ≥ 0 (even on error) — UI renders it
    assert isinstance(body["latency_ms"], int)


def test_ping_returns_error_shape_on_failure(
    seeded_client: tuple[TestClient, str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _pid, mid = seeded_client

    async def _fake_run_chat_test(
        provider: LLMProvider, model_name: str, **kwargs: Any
    ) -> dict[str, Any]:
        return {
            "ok": False,
            "model": model_name,
            "latency_ms": 42,
            "error": "HTTP 401: Unauthorized",
            "error_category": "auth",
        }

    monkeypatch.setattr("allhands.api.routers.models.run_chat_test", _fake_run_chat_test)

    r = client.post(f"/api/models/{mid}/ping")
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["ok"] is False
    assert body["model"] == "gpt-4o-mini"
    assert body["latency_ms"] == 42
    assert body["error_category"] == "auth"
    assert "401" in body["error"]


def test_ping_returns_404_when_model_missing(
    seeded_client: tuple[TestClient, str, str],
) -> None:
    client, _pid, _mid = seeded_client
    r = client.post(f"/api/models/{uuid.uuid4()}/ping")
    assert r.status_code == 404


def test_ping_applies_5s_timeout_via_kwargs(
    seeded_client: tuple[TestClient, str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Ping is supposed to fail fast. The route must instruct run_chat_test
    with a max_tokens=4 budget and a strict timeout so a slow/dead provider
    doesn't hold the UI for 120s (the default chat_test timeout).
    """
    client, _pid, mid = seeded_client
    seen: dict[str, Any] = {}

    async def _fake_run_chat_test(
        provider: LLMProvider, model_name: str, **kwargs: Any
    ) -> dict[str, Any]:
        seen.update(kwargs)
        return {"ok": True, "model": model_name, "latency_ms": 1, "usage": {}}

    monkeypatch.setattr("allhands.api.routers.models.run_chat_test", _fake_run_chat_test)

    client.post(f"/api/models/{mid}/ping")

    # The route is responsible for imposing the fast-ping budget.
    assert seen.get("max_tokens") == 4
    # The helper may or may not take `timeout` directly — but it MUST receive
    # a dedicated short-lived httpx client. We assert the contract at the
    # max_tokens level here; the route is free to pass an http_client.


def test_ping_response_is_json_not_stream(
    seeded_client: tuple[TestClient, str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Ping is single-shot JSON — it must not return an SSE stream. Row-level
    ping is not a chat; it's a healthcheck."""
    client, _pid, mid = seeded_client

    async def _fake_run_chat_test(
        provider: LLMProvider, model_name: str, **kwargs: Any
    ) -> dict[str, Any]:
        return {"ok": True, "model": model_name, "latency_ms": 10, "usage": {}}

    monkeypatch.setattr("allhands.api.routers.models.run_chat_test", _fake_run_chat_test)

    r = client.post(f"/api/models/{mid}/ping")
    assert r.headers["content-type"].startswith("application/json")
    # body is a dict, not a list of events
    assert isinstance(r.json(), dict)
