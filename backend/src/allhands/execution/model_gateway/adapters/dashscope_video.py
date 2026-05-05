"""DashScope (Alibaba Bailian) text-to-video / image-to-video adapter.

Family covered: wanx-video / wan2.x-t2v-* / wan2.x-i2v-*. The wanx-video
API mirrors the wanx image API closely — task-based async with polling —
so this adapter follows the same shape as ``dashscope_image.py``.

Endpoint:
- POST {base}/services/aigc/video-generation/video-synthesis
  with header X-DashScope-Async: enable
- GET  {base}/tasks/{task_id}

Body shape (text-to-video):
  {
    "model": "wan2.5-t2v-plus",
    "input": {"prompt": "..."},
    "parameters": {
        "size": "1280*720",
        "duration": 5,
        "prompt_extend": true,
        "watermark": false
    }
  }

Body shape (image-to-video adds img_url):
  "input": {"prompt": "...", "img_url": "https://...png"}

Response (POST): {"output": {"task_id": "...", "task_status": "PENDING"}}
Response (GET):  task_status ∈ PENDING/RUNNING/SUCCEEDED/FAILED;
  on SUCCEEDED → output.video_url

Wall-clock cap: 5 minutes default — wanx-video is slow (often 60-180 s).
The poll interval defaults to 5 s vs image's 2 s for the same reason.

Reference:
- product/research/sandbox/MODEL-GATEWAY.html § 4
- https://help.aliyun.com/zh/model-studio/text-to-video-api-reference
"""

from __future__ import annotations

import asyncio
import time
from typing import ClassVar

import httpx

from allhands.core.modality import Modality
from allhands.core.model import LLMModel
from allhands.core.provider import LLMProvider
from allhands.core.video import (
    MAX_VIDEO_BYTES,
    GeneratedVideo,
    VideoGenerationRequest,
    VideoGenerationResult,
)

from ..base import _default_supports
from .openai_image import ImageProviderError as _BaseProviderError

_VALID_MIME: frozenset[str] = frozenset({"video/mp4", "video/webm"})
_PENDING_STATUSES = frozenset({"PENDING", "RUNNING"})
_TERMINAL_OK = "SUCCEEDED"
_TERMINAL_FAIL = frozenset({"FAILED", "UNKNOWN"})


# Reuse the structured-error envelope shape the image adapter exposes —
# tools / UI handle one error class instead of forking. Subclassing keeps
# isinstance checks behaving identically while the alias names the right
# domain.
class VideoProviderError(_BaseProviderError):
    """Same envelope as ImageProviderError; rename only for readability."""


def _to_dashscope_size(resolution: str) -> str:
    """``1280x720`` → ``1280*720`` (DashScope uses ``*`` separator)."""
    return resolution.replace("x", "*").replace("X", "*")


class DashScopeVideoAdapter:
    """VideoAdapter · DashScope (Alibaba Bailian) wanx text-to-video.

    Sandbox / safety:
    - Wall-clock cap (default 300 s) covers task creation + polling +
      download. 0 s cost on cap hit — the adapter just stops polling.
    - Polling cadence: 5 s (DashScope rate limits are friendlier than the
      image API; we don't want to spam the task endpoint).
    - Downloaded bytes validated: mime ∈ video/mp4, video/webm; size ≤
      MAX_VIDEO_BYTES (100 MB).
    """

    modality: ClassVar[Modality] = Modality.VIDEO
    provider_kinds: ClassVar[tuple[str, ...]] = ("aliyun",)
    # 2026-05-05 · empty patterns → accept any aliyun video model row.
    # See dashscope_image.py for the design note · model.capabilities
    # is the source of truth, name-substring matching was the
    # "every new wanx release needs a code change" anti-pattern.
    model_patterns: ClassVar[tuple[str, ...]] = ()

    def __init__(
        self,
        *,
        poll_timeout_seconds: float = 300.0,
        poll_interval_seconds: float = 5.0,
        request_timeout_seconds: float = 30.0,
    ) -> None:
        self._poll_timeout = poll_timeout_seconds
        self._poll_interval = poll_interval_seconds
        self._request_timeout = request_timeout_seconds

    async def supports(self, *, provider: LLMProvider, model: LLMModel) -> bool:
        return _default_supports(self, provider=provider, model=model)

    async def generate(
        self,
        request: VideoGenerationRequest,
        *,
        provider: LLMProvider,
        model: LLMModel,
    ) -> VideoGenerationResult:
        if not provider.api_key:
            raise VideoProviderError(
                "video provider requires an api_key",
                field="api_key",
                expected="non-empty string",
            )

        # DashScope native API base · same suffix-stripping as image adapter.
        base = provider.base_url.rstrip("/")
        if base.endswith("/compatible-mode/v1"):
            base = base[: -len("/compatible-mode/v1")] + "/api/v1"
        elif not base.endswith("/api/v1"):
            base = base + "/api/v1"

        post_url = f"{base}/services/aigc/video-generation/video-synthesis"

        params: dict[str, object] = {
            "size": _to_dashscope_size(request.resolution),
            "duration": request.duration_seconds,
            "prompt_extend": True,
            "watermark": False,
        }
        if request.fps is not None:
            params["fps"] = request.fps
        if request.seed is not None:
            params["seed"] = request.seed

        input_payload: dict[str, object] = {"prompt": request.prompt}
        if request.init_image_url:
            input_payload["img_url"] = request.init_image_url

        body: dict[str, object] = {
            "model": model.name,
            "input": input_payload,
            "parameters": params,
        }
        headers = {
            "Authorization": f"Bearer {provider.api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
        }

        started = time.monotonic()
        async with httpx.AsyncClient(timeout=self._request_timeout) as client:
            try:
                resp = await client.post(post_url, headers=headers, json=body)
            except httpx.HTTPError as exc:
                raise VideoProviderError(
                    f"network error contacting DashScope video API: {exc}",
                    field="network",
                    hint="Check provider base_url and connectivity.",
                ) from exc

            if resp.status_code != 200:
                raise VideoProviderError(
                    f"DashScope video POST returned HTTP {resp.status_code}",
                    status=resp.status_code,
                    received=resp.text[:500],
                    hint=(
                        "Common: 401 = bad api_key; 400 = bad model name "
                        "(try wan2.5-t2v-plus / wanx-video-v1); 429 = quota."
                    ),
                )
            try:
                payload = resp.json()
            except ValueError as exc:
                raise VideoProviderError(
                    "DashScope video POST returned non-JSON",
                    received=resp.text[:200],
                ) from exc

            output = payload.get("output") or {}
            task_id = output.get("task_id")
            if not task_id:
                raise VideoProviderError(
                    "DashScope video POST returned no task_id",
                    received=str(payload)[:300],
                )

            poll_url = f"{base}/tasks/{task_id}"
            poll_headers = {"Authorization": f"Bearer {provider.api_key}"}
            terminal_payload = await self._poll_until_terminal(
                client, poll_url, poll_headers, task_id
            )

            terminal_output = terminal_payload.get("output") or {}
            assert isinstance(terminal_output, dict)
            video_url = terminal_output.get("video_url") or terminal_output.get("url")
            if not video_url:
                # Some wan2.x responses nest under results[0].url
                results = terminal_output.get("results") or []
                if isinstance(results, list) and results:
                    first = results[0]
                    if isinstance(first, dict):
                        video_url = first.get("url") or first.get("video_url")
            if not video_url:
                raise VideoProviderError(
                    "DashScope video task succeeded but returned no video_url",
                    received=str(terminal_payload)[:300],
                )

            try:
                vid_resp = await client.get(video_url, timeout=120.0)
            except httpx.HTTPError as exc:
                raise VideoProviderError(
                    f"failed to download generated video: {exc}",
                    field="download",
                ) from exc
            if vid_resp.status_code != 200:
                raise VideoProviderError(
                    f"failed downloading video · HTTP {vid_resp.status_code}",
                    status=vid_resp.status_code,
                )
            raw = vid_resp.content
            if len(raw) > MAX_VIDEO_BYTES:
                raise VideoProviderError(
                    f"video too big · {len(raw)} bytes > {MAX_VIDEO_BYTES} cap",
                    field="video_size",
                )
            mime = _sniff_video_mime(raw)
            if mime not in _VALID_MIME:
                raise VideoProviderError(
                    f"DashScope returned unexpected mime {mime!r}",
                    field="mime_type",
                    expected=f"one of {sorted(_VALID_MIME)}",
                    received=mime,
                )

            video = GeneratedVideo(
                data=raw,
                mime_type=mime,  # type: ignore[arg-type]
                prompt=request.prompt,
                resolution=request.resolution,
                duration_seconds=request.duration_seconds,
                fps=request.fps,
            )

        duration_ms = int((time.monotonic() - started) * 1000)
        return VideoGenerationResult(
            videos=[video],
            duration_ms=duration_ms,
            cost_usd=None,  # DashScope doesn't expose per-call cost cleanly
            model_used=model.name,
            provider_id=provider.id,
        )

    async def _poll_until_terminal(
        self,
        client: httpx.AsyncClient,
        url: str,
        headers: dict[str, str],
        task_id: str,
    ) -> dict[str, object]:
        deadline = time.monotonic() + self._poll_timeout
        while True:
            try:
                resp = await client.get(url, headers=headers)
            except httpx.HTTPError as exc:
                raise VideoProviderError(
                    f"network error polling DashScope video task {task_id!r}: {exc}",
                    field="network",
                ) from exc
            if resp.status_code != 200:
                raise VideoProviderError(
                    f"DashScope GET task returned HTTP {resp.status_code}",
                    status=resp.status_code,
                    received=resp.text[:500],
                )
            try:
                payload = resp.json()
            except ValueError as exc:
                raise VideoProviderError(
                    "DashScope GET task returned non-JSON",
                    received=resp.text[:200],
                ) from exc
            output = payload.get("output") or {}
            status = str(output.get("task_status") or "").upper()

            if status == _TERMINAL_OK:
                return dict(payload)
            if status in _TERMINAL_FAIL:
                msg = output.get("message") or "task failed without message"
                raise VideoProviderError(
                    f"DashScope video task FAILED: {msg}",
                    field="task",
                    received=str(output)[:300],
                    hint="Check the prompt for content-policy issues; or retry.",
                )
            if status not in _PENDING_STATUSES:
                raise VideoProviderError(
                    f"DashScope video task returned unknown status {status!r}",
                    received=str(output)[:200],
                )

            if time.monotonic() >= deadline:
                raise VideoProviderError(
                    f"DashScope video task {task_id!r} timed out after {self._poll_timeout}s",
                    field="timeout",
                    expected=f"≤ {self._poll_timeout}s",
                    hint=(
                        "wanx-video can take 1-3 minutes · raise poll_timeout "
                        "or use a shorter clip."
                    ),
                )

            await asyncio.sleep(self._poll_interval)


def _sniff_video_mime(data: bytes) -> str:
    """Cheap magic-byte sniff for mp4 / webm.

    mp4 files have an ``ftyp`` box at offset 4 (and at most 32 bytes from
    start in well-formed files). webm is an EBML container that starts
    with the 4-byte signature 1A 45 DF A3.
    """
    if len(data) >= 4 and data[:4] == b"\x1a\x45\xdf\xa3":
        return "video/webm"
    head = data[:128]
    if b"ftyp" in head:
        return "video/mp4"
    return "application/octet-stream"


__all__ = ["DashScopeVideoAdapter", "VideoProviderError"]
