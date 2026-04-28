"""Image generation provider · L5 execution.

Splits *what to generate* (``core.image.ImageGenerationRequest``) from
*how to call the upstream* (OpenAI Images API · DashScope wanx · Imagen ·
Flux · local SD over HTTP). The tool layer composes these — never
imports an httpx client directly — keeping the AgentLoop and the tool
layer agnostic to provider format.

Why a Protocol (vs ABC):
- Tests substitute a ``FakeImageProvider`` without subclass dance.
- Future runners (containerized worker, remote queue) plug in trivially.
- Mirrors the ScriptRunner pattern (PR Phase A · skill_scripts).

Sandbox / safety responsibilities live HERE, not the tool layer:
- httpx timeout enforced (default 120s · OpenAI gpt-image-1.5 high quality
  can take 60s+, but never > 120s).
- Response size cap (one response > MAX_IMAGE_BYTES = malformed reply →
  RunnerError, never propagated to artifact storage).
- Image content-type validated (whitelist png/jpeg/webp · reject svg/html
  shoved at us by a malicious provider).
- API key is read once and never logged · errors include endpoint + status,
  never headers.

Reference:
- product/research/sandbox/IMAGE-GEN.html § 4.2 (this file)
- ADR 0021 self-explanation — RunnerError envelopes carry hint for the LLM
- IMAGE-GEN § 6 provider price catalogue (mirrored in core/image.py)
"""

from __future__ import annotations

import asyncio
import base64
import time
from typing import Protocol, runtime_checkable

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

_VALID_MIME: frozenset[str] = frozenset({"image/png", "image/jpeg", "image/webp"})


class ImageProviderError(Exception):
    """Surfaceable error · the tool layer wraps into ADR 0021 envelope."""

    def __init__(
        self,
        message: str,
        *,
        field: str | None = None,
        expected: str | None = None,
        received: str | None = None,
        hint: str | None = None,
        status: int | None = None,
    ) -> None:
        super().__init__(message)
        self.field = field
        self.expected = expected
        self.received = received
        self.hint = hint
        self.status = status

    def to_dict(self) -> dict[str, object]:
        d: dict[str, object] = {"error": str(self)}
        if self.field is not None:
            d["field"] = self.field
        if self.expected is not None:
            d["expected"] = self.expected
        if self.received is not None:
            d["received"] = self.received
        if self.hint is not None:
            d["hint"] = self.hint
        if self.status is not None:
            d["status"] = self.status
        return d


@runtime_checkable
class ImageProvider(Protocol):
    """Anything that can take a request and return ≥1 GeneratedImage."""

    provider_id: str
    model_name: str

    async def generate(self, request: ImageGenerationRequest) -> ImageGenerationResult: ...


# ─────────────────────────────────────────────────────────────────────────────
# OpenAI Images API impl (covers OpenAI gpt-image-* / dall-e-3 + every
# OpenAI-compatible aggregator that supports POST /images/generations).
# ─────────────────────────────────────────────────────────────────────────────


class OpenAIImageProvider:
    """Production provider · POST {base_url}/images/generations.

    Stateless · safe to share across requests. Each call constructs one
    short-lived httpx client so concurrent batch fan-out (asyncio.gather)
    stays clean — connection pool warmup buys nothing for image gen since
    each request takes 5-30 seconds anyway.
    """

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model_name: str,
        provider_id: str,
        timeout_seconds: float = 120.0,
    ) -> None:
        if not api_key:
            raise ImageProviderError(
                "image provider requires an api_key",
                field="api_key",
                expected="non-empty string",
            )
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self.model_name = model_name
        self.provider_id = provider_id
        self._timeout = timeout_seconds

    async def generate(self, request: ImageGenerationRequest) -> ImageGenerationResult:
        if request.size not in ALLOWED_SIZES:
            raise ImageProviderError(
                f"unsupported size {request.size!r}",
                field="size",
                expected=f"one of {list(ALLOWED_SIZES)}",
                received=request.size,
            )

        # OpenAI Images expects the size token directly; quality maps as-is.
        # `response_format=b64_json` ⇒ we get raw bytes back without a second
        # fetch, which keeps batch fan-out latency predictable.
        body: dict[str, object] = {
            "model": self.model_name,
            "prompt": request.prompt,
            "size": request.size if request.size != "auto" else "1024x1024",
            "n": request.n,
        }
        # quality is optional · only forward when explicitly set so older
        # OpenAI-compat aggregators that don't accept it stay happy.
        if request.quality is not ImageQuality.AUTO:
            body["quality"] = request.quality.value
        # gpt-image-1 / 1.5 don't accept response_format='b64_json' — they
        # return base64 by default. dall-e-3 needs it set explicitly. We
        # forward only when the model name starts with 'dall-e-' to avoid
        # 400 Unknown parameter on gpt-image.
        if self.model_name.startswith("dall-e"):
            body["response_format"] = "b64_json"

        url = f"{self._base_url}/images/generations"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        started = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.post(url, headers=headers, json=body)
        except httpx.TimeoutException as exc:
            raise ImageProviderError(
                f"image gen timed out after {self._timeout}s",
                field="timeout",
                expected=f"≤ {self._timeout}s",
                hint="Try a lower quality or smaller size, or batch more images.",
            ) from exc
        except httpx.HTTPError as exc:
            raise ImageProviderError(
                f"network error contacting image provider: {exc}",
                field="network",
                hint="Check your provider base_url and connectivity.",
            ) from exc

        duration_ms = int((time.monotonic() - started) * 1000)

        if resp.status_code != 200:
            # Surface the upstream error code + body so the LLM can self-correct
            # (e.g. wrong model name → 404; bad prompt content → 400 with
            # moderation message).
            body_excerpt = resp.text[:500]
            raise ImageProviderError(
                f"image provider returned HTTP {resp.status_code}",
                status=resp.status_code,
                received=body_excerpt,
                hint=(
                    "Read the upstream response body for the cause; common "
                    "codes: 401 = bad api_key, 404 = wrong model name, "
                    "400 = prompt rejected by moderation."
                ),
            )

        try:
            payload = resp.json()
        except ValueError as exc:
            raise ImageProviderError(
                "image provider returned non-JSON",
                received=resp.text[:200],
            ) from exc

        data = payload.get("data") or []
        if not isinstance(data, list) or not data:
            raise ImageProviderError(
                "image provider returned no images",
                received=str(payload)[:200],
            )

        images: list[GeneratedImage] = []
        for entry in data:
            b64 = entry.get("b64_json")
            if not b64:
                # Some impls return a URL · we don't follow it — the spec is
                # explicit b64. Bail with a self-explanatory error.
                raise ImageProviderError(
                    "provider returned URL instead of b64_json",
                    field="response_format",
                    expected="b64_json (inline base64)",
                    hint=(
                        "Ensure the upstream model supports b64_json (gpt-image-* "
                        "and dall-e-3 do). URL-only providers need a download step "
                        "we haven't implemented yet."
                    ),
                )
            try:
                raw = base64.b64decode(b64, validate=True)
            except (ValueError, base64.binascii.Error) as exc:  # type: ignore[attr-defined]
                raise ImageProviderError(
                    "provider returned invalid base64",
                    received=str(exc)[:120],
                ) from exc
            if len(raw) > MAX_IMAGE_BYTES:
                raise ImageProviderError(
                    f"image too big · {len(raw)} bytes > {MAX_IMAGE_BYTES} cap",
                    field="image_size",
                    expected=f"≤ {MAX_IMAGE_BYTES} bytes",
                    hint="Lower quality or smaller dimensions.",
                )
            mime = _sniff_mime(raw)
            if mime not in _VALID_MIME:
                raise ImageProviderError(
                    f"provider returned unexpected mime {mime!r}",
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
                    revised_prompt=entry.get("revised_prompt"),
                )
            )

        cost = estimate_cost(
            model_name=self.model_name,
            quality=request.quality,
            size=request.size,
            n=len(images),
        )

        return ImageGenerationResult(
            images=images,
            duration_ms=duration_ms,
            cost_usd=cost,
            model_used=self.model_name,
            provider_id=self.provider_id,
        )


def _sniff_mime(blob: bytes) -> str:
    """Cheap mime sniff · just enough to validate the provider response."""
    if blob[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if blob[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        return "image/webp"
    return "application/octet-stream"


# ─────────────────────────────────────────────────────────────────────────────
# Fan-out helper · single shot many prompts in parallel · used by tool layer.
# Lives here (not the tool) so future schedulers (rate limiter / batch worker)
# only need to swap one function.
# ─────────────────────────────────────────────────────────────────────────────


async def generate_batch(
    provider: ImageProvider,
    prompts: list[str],
    *,
    size: str = "1024x1024",
    quality: ImageQuality = ImageQuality.AUTO,
) -> list[ImageGenerationResult | ImageProviderError]:
    """Run N prompts concurrently · returns list aligned with input.

    Errors are returned in-place (NOT raised) so a single failed prompt
    doesn't sink the whole batch — the tool layer reports per-image
    success/failure to the LLM, and the LLM can decide to retry only the
    failures (or just use the partial set).
    """
    requests = [ImageGenerationRequest(prompt=p, size=size, quality=quality, n=1) for p in prompts]

    async def _one(req: ImageGenerationRequest) -> ImageGenerationResult | ImageProviderError:
        try:
            return await provider.generate(req)
        except ImageProviderError as exc:
            return exc

    return await asyncio.gather(*(_one(r) for r in requests))


# ─────────────────────────────────────────────────────────────────────────────
# Fake — for unit tests · deterministic + zero network.
# ─────────────────────────────────────────────────────────────────────────────


class FakeImageProvider:
    """Deterministic test fake · returns a single 1x1 PNG (or canned bytes)."""

    # 1x1 transparent PNG · 67 bytes
    _ONE_PIXEL_PNG = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    )

    def __init__(
        self,
        *,
        provider_id: str = "fake",
        model_name: str = "fake-image-1",
        canned_bytes: bytes | None = None,
        raises: ImageProviderError | None = None,
    ) -> None:
        self.provider_id = provider_id
        self.model_name = model_name
        self._bytes = canned_bytes if canned_bytes is not None else self._ONE_PIXEL_PNG
        self._raises = raises
        self.last_request: ImageGenerationRequest | None = None
        self.call_count = 0

    async def generate(self, request: ImageGenerationRequest) -> ImageGenerationResult:
        self.last_request = request
        self.call_count += 1
        if self._raises is not None:
            raise self._raises
        return ImageGenerationResult(
            images=[
                GeneratedImage(
                    data=self._bytes,
                    mime_type="image/png",
                    prompt=request.prompt,
                    size=request.size,
                )
                for _ in range(request.n)
            ],
            duration_ms=1,
            cost_usd=0.0,
            model_used=self.model_name,
            provider_id=self.provider_id,
        )


__all__ = [
    "FakeImageProvider",
    "ImageProvider",
    "ImageProviderError",
    "OpenAIImageProvider",
    "generate_batch",
]
