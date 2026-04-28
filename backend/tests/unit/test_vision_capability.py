"""Unit tests for vision-capability auto-detection."""

from __future__ import annotations

import pytest

from allhands.services.vision_capability import infer_supports_images


@pytest.mark.parametrize(
    "name",
    [
        "claude-3-5-sonnet-20241022",
        "claude-3-haiku-20240307",
        "claude-sonnet-4-6",
        "claude-opus-4-7",
        "claude-haiku-4-5-20251001",
        "gpt-4o",
        "gpt-4o-mini",
        "gpt-4.1",
        "gpt-4-turbo",
        "gpt-4-vision-preview",
        "o1",
        "o3-mini",
        "o4-mini",
        "qwen-vl-plus",
        "qwen-vl-max",
        "qwen3-vl-72b",
        "qvq-72b-preview",
        "deepseek-vl-7b",
        "gemini-1.5-pro",
        "gemini-2.0-flash",
        "llama-3.2-11b-vision-instruct",
        "llama-3.2-90b-vision",
        "pixtral-12b",
        "glm-4v",
        "glm-4.5v",
        "yi-vl-34b",
        "yi-vision",
        "internvl-chat",
        "minicpm-v-2.6",
    ],
)
def test_known_vision_models(name: str) -> None:
    assert infer_supports_images(name) is True, name


@pytest.mark.parametrize(
    "name",
    [
        "qwen-plus",
        "qwen3.6-plus",
        "kimi-k2.5",
        "deepseek-chat",
        "deepseek-coder",
        "claude-2",
        "gpt-3.5-turbo",
        "gpt-4",
        "llama-3.1-70b",
        "mistral-large",
        "MiniMax-M2.5",
        "",
    ],
)
def test_non_vision_models(name: str) -> None:
    assert infer_supports_images(name) is False, name
