"""Integration tests for provider-kind surface:

  - GET /api/providers/presets returns the static registry (3 kinds)
  - POST /api/providers accepts `kind` and round-trips through list/GET
  - POST /api/providers/:id/test uses the correct URL + headers per kind
    (httpx is monkeypatched so we observe the call without hitting network)

These tests cover the contract both the UI dropdown and the Lead Agent's
meta tool rely on. Unit coverage for the adapter itself lives in
tests/unit/test_llm_factory.py.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from allhands.api import create_app
from allhands.api.deps import get_session
from allhands.core.provider import LLMProvider
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlLLMProviderRepo


@pytest.fixture
def client_with_providers() -> tuple[TestClient, dict[str, str]]:
    """Spin up the app with an in-memory sqlite and seed one provider per kind."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    ids = {
        "openai": str(uuid.uuid4()),
        "anthropic": str(uuid.uuid4()),
        "aliyun": str(uuid.uuid4()),
    }

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
            repo = SqlLLMProviderRepo(s)
            await repo.upsert(
                LLMProvider(
                    id=ids["openai"],
                    name="OAI",
                    kind="openai",
                    base_url="https://api.openai.com/v1",
                    api_key="sk-fake-openai",
                    default_model="gpt-4o-mini",
                    is_default=True,
                )
            )
            await repo.upsert(
                LLMProvider(
                    id=ids["anthropic"],
                    name="Anthropic",
                    kind="anthropic",
                    base_url="https://api.anthropic.com",
                    api_key="sk-ant-fake",
                    default_model="claude-3-5-sonnet-latest",
                    is_default=False,
                )
            )
            await repo.upsert(
                LLMProvider(
                    id=ids["aliyun"],
                    name="Bailian",
                    kind="aliyun",
                    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
                    api_key="sk-fake-aliyun",
                    default_model="qwen-plus",
                    is_default=False,
                )
            )

    asyncio.run(_seed())

    app = create_app()
    app.dependency_overrides[get_session] = _session
    return TestClient(app), ids


def test_presets_endpoint_returns_three_supported_kinds() -> None:
    client = TestClient(create_app())
    r = client.get("/api/providers/presets")
    assert r.status_code == 200, r.text
    body = r.json()
    assert {p["kind"] for p in body} == {"openai", "anthropic", "aliyun"}
    # Every preset must carry the fields the UI autofill relies on.
    for p in body:
        assert p["label"]
        assert p["base_url"].startswith("http")
        assert p["default_model"]
        assert p["key_hint"]
        assert p["doc_hint"]


def test_create_provider_with_anthropic_kind_round_trips() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    async def _session() -> AsyncIterator[AsyncSession]:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as s, s.begin():
            yield s

    async def _init() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_init())

    app = create_app()
    app.dependency_overrides[get_session] = _session
    client = TestClient(app)

    r = client.post(
        "/api/providers",
        json={
            "name": "MyAnthropic",
            "kind": "anthropic",
            "base_url": "https://api.anthropic.com",
            "api_key": "sk-ant-roundtrip",
            "default_model": "claude-3-5-sonnet-latest",
            "set_as_default": False,
        },
    )
    assert r.status_code in (200, 201), r.text
    created = r.json()
    assert created["kind"] == "anthropic"
    # Key is never echoed back.
    assert "api_key" not in created
    assert created["api_key_set"] is True

    listed = client.get("/api/providers").json()
    match = next(p for p in listed if p["id"] == created["id"])
    assert match["kind"] == "anthropic"
    assert match["base_url"] == "https://api.anthropic.com"


def test_test_endpoint_probes_anthropic_with_x_api_key(
    client_with_providers: tuple[TestClient, dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, ids = client_with_providers

    captured: dict[str, Any] = {}

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        return httpx.Response(200, json={"data": []})

    transport = httpx.MockTransport(_handler)

    # The route instantiates httpx.AsyncClient() with no args — inject transport.
    import httpx as _httpx_module

    class _PatchedAsyncClient(_httpx_module.AsyncClient):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    monkeypatch.setattr("httpx.AsyncClient", _PatchedAsyncClient)

    r = client.post(f"/api/providers/{ids['anthropic']}/test")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True

    # Anthropic probe must hit /v1/models with x-api-key + anthropic-version.
    assert captured["url"] == "https://api.anthropic.com/v1/models"
    assert captured["headers"]["x-api-key"] == "sk-ant-fake"
    assert captured["headers"]["anthropic-version"] == "2023-06-01"
    # Anthropic does not use Bearer — never leak that header.
    assert "authorization" not in {k.lower() for k in captured["headers"]}


def test_test_endpoint_probes_aliyun_as_openai_compat(
    client_with_providers: tuple[TestClient, dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, ids = client_with_providers

    captured: dict[str, Any] = {}

    def _handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        return httpx.Response(200, json={"data": []})

    transport = httpx.MockTransport(_handler)

    import httpx as _httpx_module

    class _PatchedAsyncClient(_httpx_module.AsyncClient):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    monkeypatch.setattr("httpx.AsyncClient", _PatchedAsyncClient)

    r = client.post(f"/api/providers/{ids['aliyun']}/test")
    assert r.status_code == 200, r.text

    # DashScope compatible-mode is OpenAI-wire under the hood.
    assert captured["url"] == ("https://dashscope.aliyuncs.com/compatible-mode/v1/models")
    assert captured["headers"]["authorization"] == "Bearer sk-fake-aliyun"
