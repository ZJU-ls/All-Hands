"""DashScope wanx-video adapter — unit tests with mocked HTTP."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from allhands.core.model import Capability, LLMModel
from allhands.core.provider import LLMProvider
from allhands.core.video import VideoGenerationRequest
from allhands.execution.model_gateway.adapters.dashscope_video import (
    DashScopeVideoAdapter,
    VideoProviderError,
    _sniff_video_mime,
    _to_dashscope_size,
)


def _make_provider() -> LLMProvider:
    return LLMProvider(
        id="p1",
        name="百炼",
        kind="aliyun",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        api_key="sk-test",
        enabled=True,
    )


def _make_model(name: str = "wan2.5-t2v-plus") -> LLMModel:
    return LLMModel(
        id="m1",
        provider_id="p1",
        name=name,
        capabilities=[Capability.VIDEO_GEN],
    )


def test_to_dashscope_size_x_to_star() -> None:
    assert _to_dashscope_size("1280x720") == "1280*720"
    assert _to_dashscope_size("1920X1080") == "1920*1080"


def test_sniff_mime_mp4() -> None:
    fake_mp4 = b"\x00\x00\x00\x20ftyp" + b"\x00" * 100
    assert _sniff_video_mime(fake_mp4) == "video/mp4"


def test_sniff_mime_webm() -> None:
    assert _sniff_video_mime(b"\x1a\x45\xdf\xa3" + b"\x00" * 100) == "video/webm"


def test_sniff_mime_unknown() -> None:
    assert _sniff_video_mime(b"random bytes") == "application/octet-stream"


def test_supports_aliyun_video_models() -> None:
    a = DashScopeVideoAdapter()
    assert "aliyun" in a.provider_kinds
    assert any("t2v" in p or "video" in p for p in a.model_patterns)


@pytest.mark.asyncio
async def test_generate_no_api_key_rejected() -> None:
    a = DashScopeVideoAdapter()
    p = _make_provider().model_copy(update={"api_key": None})
    with pytest.raises(VideoProviderError, match="api_key"):
        await a.generate(
            VideoGenerationRequest(prompt="hello world test prompt"),
            provider=p,
            model=_make_model(),
        )


@pytest.mark.asyncio
async def test_generate_full_path_with_mock() -> None:
    """Mock POST → task pending → poll succeeds → download mp4."""
    a = DashScopeVideoAdapter(poll_interval_seconds=0.001, poll_timeout_seconds=5.0)
    fake_mp4 = b"\x00\x00\x00\x20ftypmp42" + b"\x00" * 200

    post_resp = httpx.Response(
        200, json={"output": {"task_id": "task-1", "task_status": "PENDING"}}
    )
    poll_resp = httpx.Response(
        200,
        json={
            "output": {
                "task_id": "task-1",
                "task_status": "SUCCEEDED",
                "video_url": "https://cdn.example.com/v.mp4",
            }
        },
    )
    download_resp = httpx.Response(200, content=fake_mp4)

    async def mock_post(_url: str, **_kwargs: object) -> httpx.Response:
        return post_resp

    async def mock_get(url: str, **_kwargs: object) -> httpx.Response:
        if "tasks" in url:
            return poll_resp
        return download_resp

    with (
        patch.object(httpx.AsyncClient, "post", AsyncMock(side_effect=mock_post)),
        patch.object(httpx.AsyncClient, "get", AsyncMock(side_effect=mock_get)),
    ):
        result = await a.generate(
            VideoGenerationRequest(prompt="a sunset over mountains"),
            provider=_make_provider(),
            model=_make_model(),
        )

    assert len(result.videos) == 1
    assert result.videos[0].mime_type == "video/mp4"
    assert result.videos[0].data == fake_mp4
    assert result.model_used == "wan2.5-t2v-plus"


@pytest.mark.asyncio
async def test_generate_handles_failed_task() -> None:
    a = DashScopeVideoAdapter(poll_interval_seconds=0.001, poll_timeout_seconds=5.0)
    post_resp = httpx.Response(200, json={"output": {"task_id": "x", "task_status": "PENDING"}})
    fail_resp = httpx.Response(
        200,
        json={
            "output": {
                "task_id": "x",
                "task_status": "FAILED",
                "message": "content policy violation",
            }
        },
    )

    async def mock_post(_url: str, **_kwargs: object) -> httpx.Response:
        return post_resp

    async def mock_get(_url: str, **_kwargs: object) -> httpx.Response:
        return fail_resp

    with (
        patch.object(httpx.AsyncClient, "post", AsyncMock(side_effect=mock_post)),
        patch.object(httpx.AsyncClient, "get", AsyncMock(side_effect=mock_get)),
    ):
        with pytest.raises(VideoProviderError, match="FAILED"):
            await a.generate(
                VideoGenerationRequest(prompt="bad prompt example here"),
                provider=_make_provider(),
                model=_make_model(),
            )


@pytest.mark.asyncio
async def test_generate_handles_post_error() -> None:
    a = DashScopeVideoAdapter()
    err_resp = httpx.Response(401, text="invalid api key")

    async def mock_post(_url: str, **_kwargs: object) -> httpx.Response:
        return err_resp

    with patch.object(httpx.AsyncClient, "post", AsyncMock(side_effect=mock_post)):
        with pytest.raises(VideoProviderError, match="401"):
            await a.generate(
                VideoGenerationRequest(prompt="hello world test prompt"),
                provider=_make_provider(),
                model=_make_model(),
            )
