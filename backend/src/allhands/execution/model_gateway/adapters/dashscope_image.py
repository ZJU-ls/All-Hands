"""DashScope (Alibaba Bailian) text-to-image adapter · wanx / wan2.x family.

The wanx API is task-based — POST creates a task, GET polls until status
is SUCCEEDED, then we download the image bytes from the returned URL.
The whole polling loop is hidden inside ``generate()`` so the gateway and
tool layer see the same async-but-blocking contract as OpenAI.

Endpoint:
- POST {base}/services/aigc/text2image/image-synthesis
  with header X-DashScope-Async: enable
- GET  {base}/tasks/{task_id}

Body shape (the *older* protocol used by wan2.x / wanx-*):
  {
    "model": "wanx-v1",
    "input": {"prompt": "..."},
    "parameters": {"size": "1024*1024", "n": 1, "prompt_extend": true}
  }

Response (POST):
  {"output": {"task_id": "...", "task_status": "PENDING"}}

Response (GET task):
  {"output": {"task_id": "...", "task_status": "SUCCEEDED",
              "results": [{"url": "https://.../image.png"}]}}

Reference:
- product/research/sandbox/MODEL-GATEWAY.html § 3.4
- https://www.alibabacloud.com/help/en/model-studio/text-to-image-v2-api-reference
"""

from __future__ import annotations

import asyncio
import time
from typing import ClassVar

import httpx

from allhands.core.image import (
    ALLOWED_SIZES,
    MAX_IMAGE_BYTES,
    GeneratedImage,
    ImageGenerationRequest,
    ImageGenerationResult,
    ImageQuality,
    estimate_cost,
)
from allhands.core.modality import Modality
from allhands.core.model import LLMModel
from allhands.core.provider import LLMProvider

from ..base import _default_supports
from .openai_image import ImageProviderError, _sniff_mime

_VALID_MIME: frozenset[str] = frozenset({"image/png", "image/jpeg", "image/webp"})

# DashScope task statuses we care about
_PENDING_STATUSES = frozenset({"PENDING", "RUNNING"})
_TERMINAL_OK = "SUCCEEDED"
_TERMINAL_FAIL = frozenset({"FAILED", "UNKNOWN"})


# wanx rejects any dimension outside [512, 1440]. Other ALLOWED_SIZES
# entries (1536x1024, 2048x2048) are valid for OpenAI/Imagen but not
# for DashScope. We surface a clear error pre-flight rather than letting
# DashScope reject the task 4-5s later with a cryptic message.
_WANX_MIN_DIM = 512
_WANX_MAX_DIM = 1440


def _wanx_dim_ok(dim: int) -> bool:
    return _WANX_MIN_DIM <= dim <= _WANX_MAX_DIM


def _validate_wanx_size(size: str) -> tuple[int, int] | None:
    """Return (w, h) when valid for wanx, None otherwise.

    'auto' resolves to 1024x1024 which is always valid.
    """
    if size == "auto":
        return (1024, 1024)
    try:
        w_s, h_s = size.lower().replace("*", "x").split("x")
        w, h = int(w_s), int(h_s)
    except (ValueError, AttributeError):
        return None
    if _wanx_dim_ok(w) and _wanx_dim_ok(h):
        return (w, h)
    return None


# DashScope expects size like "1024*1024" (asterisk · NOT 'x').
def _to_dashscope_size(size: str) -> str:
    if size == "auto":
        return "1024*1024"
    return size.replace("x", "*")


class DashScopeImageAdapter:
    """ImageAdapter · DashScope (Alibaba Bailian) wanx text-to-image.

    Sandbox / safety:
    - Total wall-clock cap (``poll_timeout_seconds``, default 90s) covers
      task creation + polling + download. wanx normally completes in
      10-30 s; the cap keeps a stuck task from holding the agent loop.
    - Polling cadence: 2 s (Alibaba docs recommend 10 s, but the agent
      perceives delay; 2 s is courteous to their rate limits and keeps
      median latency low).
    - Downloaded bytes are validated by mime-sniff (PNG/JPEG/WebP only).
    """

    modality: ClassVar[Modality] = Modality.IMAGE
    provider_kinds: ClassVar[tuple[str, ...]] = ("aliyun",)
    # Substring patterns that map onto wanx / wan-image families. New model
    # names get matched as long as they include "wan" + a numeric prefix.
    model_patterns: ClassVar[tuple[str, ...]] = ("wanx", "wan2", "wan-image")

    def __init__(
        self,
        *,
        poll_timeout_seconds: float = 90.0,
        poll_interval_seconds: float = 2.0,
        request_timeout_seconds: float = 30.0,
    ) -> None:
        self._poll_timeout = poll_timeout_seconds
        self._poll_interval = poll_interval_seconds
        self._request_timeout = request_timeout_seconds

    async def supports(self, *, provider: LLMProvider, model: LLMModel) -> bool:
        return _default_supports(self, provider=provider, model=model)

    async def generate(
        self,
        request: ImageGenerationRequest,
        *,
        provider: LLMProvider,
        model: LLMModel,
    ) -> ImageGenerationResult:
        if not provider.api_key:
            raise ImageProviderError(
                "image provider requires an api_key",
                field="api_key",
                expected="non-empty string",
            )
        if request.size not in ALLOWED_SIZES:
            raise ImageProviderError(
                f"unsupported size {request.size!r}",
                field="size",
                expected=f"one of {list(ALLOWED_SIZES)}",
                received=request.size,
            )
        # wanx-specific dimension range · catch before spending 4s on the
        # round-trip. Discovered via real-LLM soak (ADR 0021 envelope · the
        # hint tells the agent which sizes wanx actually accepts).
        if _validate_wanx_size(request.size) is None:
            raise ImageProviderError(
                f"size {request.size!r} unsupported by wanx (each side must be 512-1440)",
                field="size",
                expected="each dimension in [512, 1440] · try 1024x1024 / 1024x1440 / 1440x1024",
                received=request.size,
                hint=(
                    "DashScope wanx caps each dimension at 1440. The ALLOWED_SIZES "
                    "values 1536x1024 / 1024x1536 / 2048x2048 are valid for "
                    "OpenAI/Imagen but not DashScope · pick a smaller size."
                ),
            )

        # The DashScope OpenAI-compat endpoint returns 404 for /images/generations
        # (we tested), so we use the *native* DashScope API base. Strip any
        # /compatible-mode/v1 suffix the user configured for chat models.
        base = provider.base_url.rstrip("/")
        if base.endswith("/compatible-mode/v1"):
            base = base[: -len("/compatible-mode/v1")] + "/api/v1"
        elif not base.endswith("/api/v1"):
            base = base + "/api/v1"

        post_url = f"{base}/services/aigc/text2image/image-synthesis"
        body: dict[str, object] = {
            "model": model.name,
            "input": {"prompt": request.prompt},
            "parameters": {
                "size": _to_dashscope_size(request.size),
                "n": request.n,
                "prompt_extend": True,  # let DashScope auto-enrich short prompts
                "watermark": False,
            },
        }
        # Quality maps loosely · DashScope doesn't expose tier the same way.
        # For HD/HIGH we hint a larger size when caller said 'auto'.
        if request.quality is ImageQuality.HIGH and request.size == "auto":
            body["parameters"]["size"] = "1280*1280"  # type: ignore[index]

        headers = {
            "Authorization": f"Bearer {provider.api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable",
        }

        started = time.monotonic()

        async with httpx.AsyncClient(timeout=self._request_timeout) as client:
            # 1) Submit task
            try:
                resp = await client.post(post_url, headers=headers, json=body)
            except httpx.HTTPError as exc:
                raise ImageProviderError(
                    f"network error contacting DashScope: {exc}",
                    field="network",
                    hint="Check provider base_url and connectivity.",
                ) from exc

            if resp.status_code != 200:
                raise ImageProviderError(
                    f"DashScope POST returned HTTP {resp.status_code}",
                    status=resp.status_code,
                    received=resp.text[:500],
                    hint=(
                        "Common: 401 = bad api_key; 400 = bad model name (try "
                        "wanx-v1 / wan2.5-t2i-preview); 429 = quota exceeded."
                    ),
                )
            try:
                payload = resp.json()
            except ValueError as exc:
                raise ImageProviderError(
                    "DashScope POST returned non-JSON",
                    received=resp.text[:200],
                ) from exc

            output = payload.get("output") or {}
            task_id = output.get("task_id")
            if not task_id:
                raise ImageProviderError(
                    "DashScope POST returned no task_id",
                    received=str(payload)[:300],
                )

            # 2) Poll until SUCCEEDED / FAILED / timeout
            poll_url = f"{base}/tasks/{task_id}"
            poll_headers = {"Authorization": f"Bearer {provider.api_key}"}

            terminal_payload = await self._poll_until_terminal(
                client, poll_url, poll_headers, task_id
            )

            output_obj = terminal_payload.get("output") or {}
            assert isinstance(output_obj, dict)
            results = output_obj.get("results") or []
            if not results:
                raise ImageProviderError(
                    "DashScope task succeeded but returned no results",
                    received=str(terminal_payload)[:300],
                )

            # 3) Download each image URL → bytes
            images: list[GeneratedImage] = []
            for entry in results:
                # Each entry is either {url: "..."} or contains an error
                if entry.get("code"):
                    # Per-image content-policy block · skip but record
                    continue
                url = entry.get("url")
                if not url:
                    continue
                try:
                    img_resp = await client.get(url)
                except httpx.HTTPError as exc:
                    raise ImageProviderError(
                        f"failed to download generated image: {exc}",
                        field="download",
                    ) from exc
                if img_resp.status_code != 200:
                    raise ImageProviderError(
                        f"failed downloading image · HTTP {img_resp.status_code}",
                        status=img_resp.status_code,
                    )
                raw = img_resp.content
                if len(raw) > MAX_IMAGE_BYTES:
                    raise ImageProviderError(
                        f"image too big · {len(raw)} bytes > {MAX_IMAGE_BYTES} cap",
                        field="image_size",
                    )
                mime = _sniff_mime(raw)
                if mime not in _VALID_MIME:
                    raise ImageProviderError(
                        f"DashScope returned unexpected mime {mime!r}",
                        field="mime_type",
                        expected=f"one of {sorted(_VALID_MIME)}",
                        received=mime,
                    )
                images.append(
                    GeneratedImage(
                        data=raw,
                        mime_type=mime,  # type: ignore[arg-type]
                        prompt=request.prompt,
                        size=request.size,
                        revised_prompt=None,
                    )
                )

            if not images:
                raise ImageProviderError(
                    "all images blocked by DashScope content policy",
                    received=str(terminal_payload)[:300],
                    hint="Try a different prompt; the moderation filter rejected all variants.",
                )

        duration_ms = int((time.monotonic() - started) * 1000)
        cost = estimate_cost(
            model_name=model.name,
            quality=request.quality,
            size=request.size,
            n=len(images),
        )
        return ImageGenerationResult(
            images=images,
            duration_ms=duration_ms,
            cost_usd=cost,
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
        """Poll GET /tasks/{task_id} every ``_poll_interval`` until terminal
        or ``_poll_timeout`` reached."""
        deadline = time.monotonic() + self._poll_timeout
        while True:
            try:
                resp = await client.get(url, headers=headers)
            except httpx.HTTPError as exc:
                raise ImageProviderError(
                    f"network error polling DashScope task {task_id!r}: {exc}",
                    field="network",
                ) from exc
            if resp.status_code != 200:
                raise ImageProviderError(
                    f"DashScope GET task returned HTTP {resp.status_code}",
                    status=resp.status_code,
                    received=resp.text[:500],
                )
            try:
                payload = resp.json()
            except ValueError as exc:
                raise ImageProviderError(
                    "DashScope GET task returned non-JSON",
                    received=resp.text[:200],
                ) from exc
            output = payload.get("output") or {}
            status = str(output.get("task_status") or "").upper()

            if status == _TERMINAL_OK:
                return dict(payload)
            if status in _TERMINAL_FAIL:
                msg = output.get("message") or "task failed without message"
                raise ImageProviderError(
                    f"DashScope task FAILED: {msg}",
                    field="task",
                    received=str(output)[:300],
                    hint="Check the prompt for content-policy issues; or retry.",
                )
            if status not in _PENDING_STATUSES:
                # Unknown status · don't loop forever · surface clearly.
                raise ImageProviderError(
                    f"DashScope task returned unknown status {status!r}",
                    received=str(output)[:200],
                )

            if time.monotonic() >= deadline:
                raise ImageProviderError(
                    f"DashScope task {task_id!r} timed out after {self._poll_timeout}s",
                    field="timeout",
                    expected=f"≤ {self._poll_timeout}s",
                    hint="Try a smaller size or simpler prompt; wanx HD can be slow.",
                )

            await asyncio.sleep(self._poll_interval)


__all__ = ["DashScopeImageAdapter"]
