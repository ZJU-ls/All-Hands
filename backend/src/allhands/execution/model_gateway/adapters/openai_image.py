"""OpenAI Images API adapter · gpt-image-1 / 1.5 / dall-e-3 + every
OpenAI-compatible aggregator that exposes ``POST /images/generations``.

This is the refactor of the original execution/image_provider.py:OpenAIImageProvider
into the gateway adapter shape (A2 of MODEL-GATEWAY.html). Behavior is
identical · the public class name is preserved as an alias in
``execution.image_provider`` for backwards-compat (deprecated for one release).

Why the refactor:
- Adapters live next to siblings (DashScope · Imagen · FLUX · Replicate)
  so a code-reviewer sees the whole image-modality matrix at a glance.
- Adapter declares ``provider_kinds = ("openai",)`` + ``model_patterns =
  ("gpt-image", "dall-e")`` so the Gateway's ``_pick`` can route without
  reading any wire-format code.
- Future Phase B middleware (cost ledger · retry · rate limit) lives at
  the Gateway, not duplicated per provider.

Reference:
- product/research/sandbox/MODEL-GATEWAY.html § 3.4 (this file)
- ADR 0021 self-explanation
"""

from __future__ import annotations

import base64
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

_VALID_MIME: frozenset[str] = frozenset({"image/png", "image/jpeg", "image/webp"})


class ImageProviderError(Exception):
    """Surfaceable error · tool layer wraps into ADR 0021 envelope.

    Kept here (rather than in ``../exceptions.py``) because every image
    adapter raises this same shape — keeping it in this module makes the
    contract obvious to adapter authors.
    """

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


class OpenAIImageAdapter:
    """ImageAdapter · OpenAI Images API.

    Sandbox / safety responsibilities live HERE, not the Gateway:
    - httpx timeout enforced (default 120s · OpenAI gpt-image-1.5 high
      quality can hit 60s+, but never > 120s).
    - Response size cap (MAX_IMAGE_BYTES = 20MB · matches artifact storage).
    - Image content-type validated (whitelist png/jpeg/webp · reject svg
      / html shoved at us by a malicious provider).
    - API key is read once and never logged · errors include endpoint +
      status, never headers.
    """

    modality: ClassVar[Modality] = Modality.IMAGE
    provider_kinds: ClassVar[tuple[str, ...]] = ("openai",)
    # 2026-05-05 · empty patterns → accept any openai image model row.
    # The model registry (``capabilities`` includes ``image``) decides what
    # is an image model; the OpenAI Images API will reject a misclassified
    # model with a clear server error, which is more honest than guessing
    # from a name substring.
    model_patterns: ClassVar[tuple[str, ...]] = ()

    def __init__(self, *, timeout_seconds: float = 120.0) -> None:
        self._timeout = timeout_seconds

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

        body: dict[str, object] = {
            "model": model.name,
            "prompt": request.prompt,
            "size": request.size if request.size != "auto" else "1024x1024",
            "n": request.n,
        }
        if request.quality is not ImageQuality.AUTO:
            body["quality"] = request.quality.value
        # gpt-image-1 / 1.5 don't accept response_format='b64_json' (returns
        # base64 by default); dall-e-3 needs it explicit. Forward only when
        # the model name starts with 'dall-e-' to avoid 400 on gpt-image.
        if model.name.startswith("dall-e"):
            body["response_format"] = "b64_json"

        url = f"{provider.base_url.rstrip('/')}/images/generations"
        headers = {
            "Authorization": f"Bearer {provider.api_key}",
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


def _sniff_mime(blob: bytes) -> str:
    """Cheap mime sniff · just enough to validate the provider response."""
    if blob[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if blob[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        return "image/webp"
    return "application/octet-stream"


__all__ = [
    "ImageProviderError",
    "OpenAIImageAdapter",
]
