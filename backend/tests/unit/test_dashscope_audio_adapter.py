"""DashScope cosyvoice TTS adapter — unit tests with mocked HTTP."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from allhands.core.audio import AudioFormat, TTSRequest
from allhands.core.model import Capability, LLMModel
from allhands.core.provider import LLMProvider
from allhands.execution.model_gateway.adapters.dashscope_audio import (
    AudioProviderError,
    DashScopeAudioAdapter,
    _extract_audio_url,
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


def _make_model(name: str = "cosyvoice-v1") -> LLMModel:
    return LLMModel(
        id="m1",
        provider_id="p1",
        name=name,
        capabilities=[Capability.SPEECH],
    )


def test_extract_audio_url_from_audio_obj() -> None:
    out = {"audio": {"url": "https://x/a.mp3"}}
    assert _extract_audio_url(out) == "https://x/a.mp3"


def test_extract_audio_url_from_top_level() -> None:
    assert _extract_audio_url({"url": "https://x/a.mp3"}) == "https://x/a.mp3"


def test_extract_audio_url_from_results_array() -> None:
    out = {"results": [{"url": "https://x/a.mp3"}]}
    assert _extract_audio_url(out) == "https://x/a.mp3"


def test_extract_audio_url_missing_returns_none() -> None:
    assert _extract_audio_url({}) is None
    assert _extract_audio_url({"results": []}) is None


@pytest.mark.asyncio
async def test_generate_no_api_key_rejected() -> None:
    a = DashScopeAudioAdapter()
    p = _make_provider().model_copy(update={"api_key": None})
    with pytest.raises(AudioProviderError, match="api_key"):
        await a.generate(TTSRequest(text="hello"), provider=p, model=_make_model())


@pytest.mark.asyncio
async def test_generate_full_path_with_inline_url() -> None:
    """DashScope returns the URL directly on the POST response (small clip)."""
    a = DashScopeAudioAdapter(poll_interval_seconds=0.001)
    fake_mp3 = b"\xff\xfb\x90\x00" + b"\x00" * 1000  # MP3 header + filler

    post_resp = httpx.Response(
        200, json={"output": {"audio": {"url": "https://cdn.example.com/a.mp3"}}}
    )
    download_resp = httpx.Response(200, content=fake_mp3)

    async def mock_post(_url: str, **_kwargs: object) -> httpx.Response:
        return post_resp

    async def mock_get(_url: str, **_kwargs: object) -> httpx.Response:
        return download_resp

    with (
        patch.object(httpx.AsyncClient, "post", AsyncMock(side_effect=mock_post)),
        patch.object(httpx.AsyncClient, "get", AsyncMock(side_effect=mock_get)),
    ):
        result = await a.generate(
            TTSRequest(text="你好世界,这是一条测试语音", voice="longxiaochun"),
            provider=_make_provider(),
            model=_make_model(),
        )

    assert result.audio is not None
    assert result.audio.data == fake_mp3
    assert result.audio.mime_type == "audio/mpeg"
    assert result.audio.format is AudioFormat.MP3


@pytest.mark.asyncio
async def test_generate_full_path_with_polling() -> None:
    """No inline url → poll task → audio_url on terminal."""
    a = DashScopeAudioAdapter(poll_interval_seconds=0.001, poll_timeout_seconds=5.0)
    fake_wav = b"RIFF\x00\x00\x00\x00WAVE" + b"\x00" * 100

    post_resp = httpx.Response(200, json={"output": {"task_id": "t1", "task_status": "PENDING"}})
    poll_resp = httpx.Response(
        200,
        json={
            "output": {
                "task_id": "t1",
                "task_status": "SUCCEEDED",
                "audio": {"url": "https://cdn.example.com/a.wav"},
            }
        },
    )
    download_resp = httpx.Response(200, content=fake_wav)

    async def mock_post(_url: str, **_kwargs: object) -> httpx.Response:
        return post_resp

    async def mock_get(url: str, **_kwargs: object) -> httpx.Response:
        if "/tasks/" in url:
            return poll_resp
        return download_resp

    with (
        patch.object(httpx.AsyncClient, "post", AsyncMock(side_effect=mock_post)),
        patch.object(httpx.AsyncClient, "get", AsyncMock(side_effect=mock_get)),
    ):
        result = await a.generate(
            TTSRequest(text="测试", voice="zhichu", format=AudioFormat.WAV),
            provider=_make_provider(),
            model=_make_model(),
        )

    assert result.audio is not None
    assert result.audio.data == fake_wav
    assert result.audio.format is AudioFormat.WAV


@pytest.mark.asyncio
async def test_generate_handles_post_error() -> None:
    a = DashScopeAudioAdapter()
    err_resp = httpx.Response(429, text="quota exceeded")

    async def mock_post(_url: str, **_kwargs: object) -> httpx.Response:
        return err_resp

    with patch.object(httpx.AsyncClient, "post", AsyncMock(side_effect=mock_post)):
        with pytest.raises(AudioProviderError, match="429"):
            await a.generate(TTSRequest(text="hi"), provider=_make_provider(), model=_make_model())


def test_supports_aliyun_audio_models() -> None:
    """Post-2026-05-05 · adapter only declares provider.kind ("aliyun");
    name-substring matching for cosyvoice / sambert / future families
    was the "every new release needs a code change" anti-pattern."""
    a = DashScopeAudioAdapter()
    assert "aliyun" in a.provider_kinds
    assert a.model_patterns == ()
