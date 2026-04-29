"""Audio-generation domain models · L4 core · pydantic only.

Two flavours under one modality:
- TTS  (text  → audio)  · OpenAI tts-1 · DashScope cosyvoice · ElevenLabs
- STT  (audio → text)   · OpenAI whisper · DashScope sensevoice · later phase

Both consumed by the same ``AudioAdapter`` Protocol (``generate``); the
adapter inspects ``request`` shape to know which mode it's in. Phase A
ships only the request types — no impl yet.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

DEFAULT_TTS_FORMAT: Literal["mp3", "wav", "ogg"] = "mp3"
MAX_AUDIO_BYTES = 50 * 1024 * 1024  # 50 MB


class AudioFormat(StrEnum):
    MP3 = "mp3"
    WAV = "wav"
    OGG = "ogg"
    FLAC = "flac"


class TTSRequest(BaseModel):
    """Text → speech."""

    text: str = Field(..., min_length=1, max_length=8000)
    voice: str = Field(default="alloy", description="Provider-specific voice id.")
    format: AudioFormat = Field(default=AudioFormat.MP3)
    speed: float = Field(default=1.0, ge=0.25, le=4.0)

    model_config = {"frozen": True}


class STTRequest(BaseModel):
    """Speech → text."""

    audio_data: bytes
    mime_type: str = Field(default="audio/mp3")
    language: str | None = Field(default=None, description="ISO 639-1 hint, e.g. 'zh', 'en'.")

    model_config = {"frozen": True, "arbitrary_types_allowed": True}


class GeneratedAudio(BaseModel):
    data: bytes
    mime_type: str
    format: AudioFormat

    model_config = {"frozen": True, "arbitrary_types_allowed": True}


class AudioGenerationResult(BaseModel):
    """For TTS: contains audio bytes; for STT: ``text`` is set instead."""

    audio: GeneratedAudio | None = None
    text: str | None = None
    duration_ms: int = Field(ge=0)
    cost_usd: float | None = Field(default=None, ge=0)
    model_used: str
    provider_id: str

    model_config = {"frozen": True}


__all__ = [
    "DEFAULT_TTS_FORMAT",
    "MAX_AUDIO_BYTES",
    "AudioFormat",
    "AudioGenerationResult",
    "GeneratedAudio",
    "STTRequest",
    "TTSRequest",
]
