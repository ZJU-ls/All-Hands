"""Auto-detect capabilities from model name patterns.

Covers chat (default), image_gen, video_gen (NEW · disambiguated against
image), speech (TTS / STT), embedding.
"""

from __future__ import annotations

import pytest

from allhands.services.model_service import (
    _looks_like_embedding_model,
    _looks_like_image_model,
    _looks_like_speech_model,
    _looks_like_video_model,
)


@pytest.mark.parametrize(
    "name",
    [
        "gpt-image-1",
        "dall-e-3",
        "wanx2.1-t2i-turbo",
        "wan2.5-image",
        "imagen-3",
        "flux-1.1-pro",
        "stable-diffusion-3",
        "kolors-v2",
    ],
)
def test_image_models_detected(name: str) -> None:
    assert _looks_like_image_model(name) is True
    assert _looks_like_video_model(name) is False


@pytest.mark.parametrize(
    "name",
    [
        "wanx-video-v1",
        "wan2.1-video-t2v",
        "wan2-i2v-plus",
        "wan2-t2v-flash",
        "sora-1",
        "veo-3",
        "kling-1.6",
        "seedance-pro",
        "vidu-2.0",
    ],
)
def test_video_models_detected(name: str) -> None:
    assert _looks_like_video_model(name) is True
    # video patterns must NOT trip the image detector
    assert _looks_like_image_model(name) is False


@pytest.mark.parametrize(
    "name",
    [
        "cosyvoice-v1",
        "cosyvoice-v2",
        "sambert-zhichu-v1",
        "tts-1",
        "tts-1-hd",
        "whisper-1",
        "whisper-large-v3",
        "sensevoice-v1",
        "paraformer-v2",
    ],
)
def test_speech_models_detected(name: str) -> None:
    assert _looks_like_speech_model(name) is True
    assert _looks_like_image_model(name) is False
    assert _looks_like_video_model(name) is False


@pytest.mark.parametrize(
    "name",
    [
        "text-embedding-3-small",
        "text-embedding-v3",
        "embedding-2",
        "bge-large-zh",
        "m3e-base",
        "gte-large",
        "voyage-3",
    ],
)
def test_embedding_models_detected(name: str) -> None:
    assert _looks_like_embedding_model(name) is True


@pytest.mark.parametrize(
    "name",
    [
        "qwen-plus",
        "qwen-max",
        "claude-sonnet-4-6",
        "gpt-4o",
        "deepseek-v3",
        "o1-preview",
        "kimi-k2",
        "glm-4-plus",
    ],
)
def test_chat_models_pass_all_specialty_detectors(name: str) -> None:
    assert _looks_like_image_model(name) is False
    assert _looks_like_video_model(name) is False
    assert _looks_like_speech_model(name) is False
    assert _looks_like_embedding_model(name) is False
