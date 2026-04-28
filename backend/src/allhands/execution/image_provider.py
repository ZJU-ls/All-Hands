"""Backwards-compat shim · prefer ``execution.model_gateway`` instead.

Phase A introduced ``OpenAIImageProvider`` here as a single-class entry
point. Phase A2 (MODEL-GATEWAY.html) refactored that into the adapter
shape under ``execution/model_gateway/adapters/openai_image.py``. This
module re-exports the new classes under the old names so existing imports
keep working — slated for removal one release after the gateway lands
(D7 in MODEL-GATEWAY.html).

Test helpers (FakeImageProvider · generate_batch) stay here for the lifetime
of those callers; they don't depend on the adapter shape.
"""

from __future__ import annotations

import asyncio
import base64
from typing import ClassVar, Protocol, runtime_checkable

from allhands.core.image import (
    GeneratedImage,
    ImageGenerationRequest,
    ImageGenerationResult,
    ImageQuality,
)
from allhands.core.modality import Modality
from allhands.execution.model_gateway.adapters.openai_image import (
    ImageProviderError,
    OpenAIImageAdapter,
)


@runtime_checkable
class ImageProvider(Protocol):
    """Legacy Protocol · kept for code that builds providers directly.

    New code should call ``ModelGateway.generate_image(request, provider, model)``
    instead of constructing a provider explicitly.
    """

    provider_id: str
    model_name: str

    async def generate(self, request: ImageGenerationRequest) -> ImageGenerationResult: ...


class OpenAIImageProvider:
    """Legacy adapter that wraps the new OpenAIImageAdapter so old callers
    keep working without code changes.

    DEPRECATED: build an LLMProvider + LLMModel and call the gateway:

        from allhands.execution.model_gateway import ModelGateway
        from allhands.execution.model_gateway.adapters import OpenAIImageAdapter
        gw = ModelGateway()
        gw.register(OpenAIImageAdapter())
        await gw.generate_image(request, provider=p, model=m)
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
        from allhands.core.model import Capability, LLMModel
        from allhands.core.provider import LLMProvider

        self.provider_id = provider_id
        self.model_name = model_name
        self._adapter = OpenAIImageAdapter(timeout_seconds=timeout_seconds)
        self._provider = LLMProvider(
            id=provider_id,
            name=provider_id,
            kind="openai",
            base_url=base_url,
            api_key=api_key,
        )
        self._model = LLMModel(
            id=f"{provider_id}-{model_name}",
            provider_id=provider_id,
            name=model_name,
            capabilities=[Capability.IMAGE_GEN],
        )

    async def generate(self, request: ImageGenerationRequest) -> ImageGenerationResult:
        return await self._adapter.generate(request, provider=self._provider, model=self._model)


# ─────────────────────────────────────────────────────────────────────────
# Test helpers · live here for the convenience of existing callers.
# ─────────────────────────────────────────────────────────────────────────


async def generate_batch(
    provider: ImageProvider,
    prompts: list[str],
    *,
    size: str = "1024x1024",
    quality: ImageQuality = ImageQuality.AUTO,
) -> list[ImageGenerationResult | ImageProviderError]:
    """Run N prompts concurrently · returns list aligned with input.

    Errors are returned in-place (NOT raised) so a single failed prompt
    doesn't sink the whole batch.
    """
    requests = [ImageGenerationRequest(prompt=p, size=size, quality=quality, n=1) for p in prompts]

    async def _one(req: ImageGenerationRequest) -> ImageGenerationResult | ImageProviderError:
        try:
            return await provider.generate(req)
        except ImageProviderError as exc:
            return exc

    return await asyncio.gather(*(_one(r) for r in requests))


class FakeImageProvider:
    """Test fake · returns canned 1x1 PNG (or supplied bytes)."""

    _ONE_PIXEL_PNG: ClassVar[bytes] = base64.b64decode(
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


# Re-export Modality so legacy imports stay valid.
_ = Modality

__all__ = [
    "FakeImageProvider",
    "ImageProvider",
    "ImageProviderError",
    "OpenAIImageProvider",
    "generate_batch",
]
