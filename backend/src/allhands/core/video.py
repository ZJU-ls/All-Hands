"""Video-generation domain models · L4 core · pydantic only.

Symmetric with core/image.py · the wire is filled in by an adapter under
``execution/model_gateway/adapters/`` (no impl in Phase A — the types ship
so the gateway / tool layer can reference them without import cycles).

Provider matrix (planned · MODEL-GATEWAY.html § 6):
- OpenAI Sora · Vertex Veo 3 · DashScope wanx-video · ByteDance Seedance ·
  Kling · Replicate Wan etc.

All these expose task-based async APIs (typically 30-300 s wall clock).
The polling loop lives inside the adapter, keeping the gateway / tool
layer interface identical to images.

Reference:
- product/research/sandbox/MODEL-GATEWAY.html § 4 (sync vs async story)
- ADR 0021 self-explaining tools
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

DEFAULT_VIDEO_RESOLUTION = "1280x720"
DEFAULT_VIDEO_DURATION = 5
MAX_VIDEO_BYTES = 100 * 1024 * 1024  # 100 MB · matches artifact "video" kind cap


# Conservative whitelist · aligns with what Veo / Sora / Wanx / Seedance accept.
ALLOWED_VIDEO_RESOLUTIONS: tuple[str, ...] = (
    "auto",
    "640x480",
    "1280x720",
    "1920x1080",
    "1080x1920",  # vertical
    "720x720",
)


class VideoQuality(StrEnum):
    AUTO = "auto"
    DRAFT = "draft"
    STANDARD = "standard"
    HIGH = "high"


class VideoGenerationRequest(BaseModel):
    """Single text-to-video (or image-to-video) request."""

    prompt: str = Field(..., min_length=3, max_length=4000)
    resolution: str = Field(default=DEFAULT_VIDEO_RESOLUTION)
    duration_seconds: int = Field(
        default=DEFAULT_VIDEO_DURATION,
        ge=1,
        le=60,
        description="Target clip length · adapters may cap further by model.",
    )
    quality: VideoQuality = Field(default=VideoQuality.AUTO)
    fps: int | None = Field(
        default=None,
        ge=8,
        le=60,
        description="Frame-rate hint · None defers to provider default.",
    )
    seed: int | None = Field(default=None, description="Reproducibility seed.")
    init_image_url: str | None = Field(
        default=None,
        description="Image-to-video starting frame (URL or data: URL).",
    )

    model_config = {"frozen": True}


class GeneratedVideo(BaseModel):
    """One video produced by the provider."""

    data: bytes
    mime_type: Literal["video/mp4", "video/webm"] = "video/mp4"
    prompt: str
    resolution: str
    duration_seconds: int
    fps: int | None = None

    model_config = {"frozen": True, "arbitrary_types_allowed": True}


class VideoGenerationResult(BaseModel):
    videos: list[GeneratedVideo] = Field(min_length=1)
    duration_ms: int = Field(ge=0)
    cost_usd: float | None = Field(default=None, ge=0)
    model_used: str
    provider_id: str

    model_config = {"frozen": True, "arbitrary_types_allowed": True}


__all__ = [
    "ALLOWED_VIDEO_RESOLUTIONS",
    "DEFAULT_VIDEO_DURATION",
    "DEFAULT_VIDEO_RESOLUTION",
    "MAX_VIDEO_BYTES",
    "GeneratedVideo",
    "VideoGenerationRequest",
    "VideoGenerationResult",
    "VideoQuality",
]
