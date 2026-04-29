"""End-to-end · /api/models/{id}/test/{image,video,audio}.

Mocks the DashScope HTTP wire so we don't need a real api_key. Verifies
the full path: REST router → ModelGateway.build_default_gateway() →
adapter dispatch → adapter generate → base64 inline response payload.
"""

from __future__ import annotations

import asyncio
import base64
import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from allhands.api.app import create_app
from allhands.api.deps import get_session
from allhands.core.model import Capability, LLMModel
from allhands.core.provider import LLMProvider
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlLLMModelRepo, SqlLLMProviderRepo


@pytest.fixture
def client_with_gen_models() -> tuple[TestClient, dict[str, str]]:
    """In-memory SQLite + provider seeded with image/video/audio models."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    pid = str(uuid.uuid4())
    mids = {
        "image": str(uuid.uuid4()),
        "video": str(uuid.uuid4()),
        "audio": str(uuid.uuid4()),
    }

    async def _session() -> AsyncIterator[AsyncSession]:
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as s:
            yield s

    async def _seed() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as s:
            await SqlLLMProviderRepo(s).upsert(
                LLMProvider(
                    id=pid,
                    name="TestBailian",
                    kind="aliyun",
                    base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
                    api_key="sk-fake-test",
                )
            )
            mr = SqlLLMModelRepo(s)
            await mr.upsert(
                LLMModel(
                    id=mids["image"],
                    provider_id=pid,
                    name="wanx2.1-t2i-turbo",
                    capabilities=[Capability.IMAGE_GEN],
                )
            )
            await mr.upsert(
                LLMModel(
                    id=mids["video"],
                    provider_id=pid,
                    name="wan2.5-t2v-plus",
                    capabilities=[Capability.VIDEO_GEN],
                )
            )
            await mr.upsert(
                LLMModel(
                    id=mids["audio"],
                    provider_id=pid,
                    name="cosyvoice-v1",
                    capabilities=[Capability.SPEECH],
                )
            )

    asyncio.run(_seed())
    app = create_app()
    app.dependency_overrides[get_session] = _session
    return TestClient(app), mids


# Tiny valid PNG (1x1 red pixel)
_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108020000009077"
    "53de0000000c4944415408d76368606000000003000160e02f380000000049"
    "454e44ae426082"
)
_MP4 = b"\x00\x00\x00\x20ftypmp42" + b"\x00" * 1024
_MP3 = b"\xff\xfb\x90\x00" + b"\x00" * 1024


def _patch_image_path(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stub adapter HTTP for image: POST → poll(SUCCEEDED) → download."""
    seq = iter(
        [
            httpx.Response(200, json={"output": {"task_id": "t-img", "task_status": "PENDING"}}),
            httpx.Response(
                200,
                json={
                    "output": {
                        "task_status": "SUCCEEDED",
                        "results": [{"url": "https://mock/img.png"}],
                    }
                },
            ),
            httpx.Response(200, content=_PNG),
        ]
    )

    async def _post(_self: Any, _url: str, **_kw: Any) -> httpx.Response:
        return next(seq)

    async def _get(_self: Any, _url: str, **_kw: Any) -> httpx.Response:
        return next(seq)

    monkeypatch.setattr(httpx.AsyncClient, "post", _post)
    monkeypatch.setattr(httpx.AsyncClient, "get", _get)


def _patch_video_path(monkeypatch: pytest.MonkeyPatch) -> None:
    seq = iter(
        [
            httpx.Response(200, json={"output": {"task_id": "t-vid", "task_status": "PENDING"}}),
            httpx.Response(
                200,
                json={
                    "output": {
                        "task_status": "SUCCEEDED",
                        "video_url": "https://mock/v.mp4",
                    }
                },
            ),
            httpx.Response(200, content=_MP4),
        ]
    )

    async def _post(_self: Any, _url: str, **_kw: Any) -> httpx.Response:
        return next(seq)

    async def _get(_self: Any, _url: str, **_kw: Any) -> httpx.Response:
        return next(seq)

    # Make poll fast
    from allhands.execution.model_gateway.adapters import dashscope_video as v

    def fast_init(self: Any) -> None:
        self._poll_timeout = 5.0
        self._poll_interval = 0.001
        self._request_timeout = 30.0

    monkeypatch.setattr(v.DashScopeVideoAdapter, "__init__", fast_init)
    monkeypatch.setattr(httpx.AsyncClient, "post", _post)
    monkeypatch.setattr(httpx.AsyncClient, "get", _get)


def _patch_audio_path(monkeypatch: pytest.MonkeyPatch) -> None:
    seq = iter(
        [
            httpx.Response(200, json={"output": {"audio": {"url": "https://mock/a.mp3"}}}),
            httpx.Response(200, content=_MP3),
        ]
    )

    async def _post(_self: Any, _url: str, **_kw: Any) -> httpx.Response:
        return next(seq)

    async def _get(_self: Any, _url: str, **_kw: Any) -> httpx.Response:
        return next(seq)

    monkeypatch.setattr(httpx.AsyncClient, "post", _post)
    monkeypatch.setattr(httpx.AsyncClient, "get", _get)


def test_image_endpoint_full_wire(
    monkeypatch: pytest.MonkeyPatch,
    client_with_gen_models: tuple[TestClient, dict[str, str]],
) -> None:
    client, mids = client_with_gen_models
    _patch_image_path(monkeypatch)
    res = client.post(
        f"/api/models/{mids['image']}/test/image",
        json={"prompt": "hello world test prompt", "size": "1024x1024", "n": 1},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["model_used"] == "wanx2.1-t2i-turbo"
    assert len(body["images"]) == 1
    assert body["images"][0]["mime_type"] == "image/png"
    assert base64.b64decode(body["images"][0]["data_b64"]) == _PNG


def test_video_endpoint_full_wire(
    monkeypatch: pytest.MonkeyPatch,
    client_with_gen_models: tuple[TestClient, dict[str, str]],
) -> None:
    client, mids = client_with_gen_models
    _patch_video_path(monkeypatch)
    res = client.post(
        f"/api/models/{mids['video']}/test/video",
        json={
            "prompt": "a sunset over mountains scene",
            "resolution": "1280x720",
            "duration_seconds": 5,
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["model_used"] == "wan2.5-t2v-plus"
    assert body["video"]["mime_type"] == "video/mp4"
    assert body["video"]["resolution"] == "1280x720"


def test_audio_endpoint_full_wire(
    monkeypatch: pytest.MonkeyPatch,
    client_with_gen_models: tuple[TestClient, dict[str, str]],
) -> None:
    client, mids = client_with_gen_models
    _patch_audio_path(monkeypatch)
    res = client.post(
        f"/api/models/{mids['audio']}/test/audio",
        json={
            "text": "hello world",
            "voice": "longxiaochun",
            "format": "mp3",
            "speed": 1.0,
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["model_used"] == "cosyvoice-v1"
    assert body["audio"]["mime_type"] == "audio/mpeg"
    assert body["audio"]["format"] == "mp3"


def test_unknown_model_returns_404(
    client_with_gen_models: tuple[TestClient, dict[str, str]],
) -> None:
    client, _ = client_with_gen_models
    res = client.post(
        "/api/models/no-such-id/test/image",
        json={"prompt": "x test prompt", "size": "1024x1024", "n": 1},
    )
    assert res.status_code == 404


def test_image_endpoint_surfaces_provider_error(
    monkeypatch: pytest.MonkeyPatch,
    client_with_gen_models: tuple[TestClient, dict[str, str]],
) -> None:
    """Adapter raises ImageProviderError → 400 with structured envelope."""
    client, mids = client_with_gen_models

    async def fail(_self: Any, *_a: Any, **_kw: Any) -> httpx.Response:
        return httpx.Response(401, text="invalid api key")

    monkeypatch.setattr(httpx.AsyncClient, "post", fail)

    res = client.post(
        f"/api/models/{mids['image']}/test/image",
        json={"prompt": "anything test prompt", "size": "1024x1024", "n": 1},
    )
    assert res.status_code == 400
    detail = res.json()["detail"]
    assert isinstance(detail, dict)
    assert "error" in detail
    assert "401" in detail["error"]


def test_video_capability_mismatch_rejected(
    client_with_gen_models: tuple[TestClient, dict[str, str]],
) -> None:
    """Calling /test/video on an IMAGE model surfaces a capability error."""
    client, mids = client_with_gen_models
    res = client.post(
        f"/api/models/{mids['image']}/test/video",
        json={
            "prompt": "x test prompt video",
            "resolution": "1280x720",
            "duration_seconds": 5,
        },
    )
    assert res.status_code == 400
    detail = res.json()["detail"]
    assert "video_gen" in str(detail).lower()
