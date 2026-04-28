"""Adapter Protocols · one Protocol per modality.

Each Protocol declares:
  - The modality it serves (class attribute · used by the registry).
  - Which (provider.kind, model_name pattern) tuples it claims (fast path
    for ``supports()`` default impl).
  - The single ``generate()`` (or ``embed()``) method that does the wire-
    format work.

Concrete adapters live in ``adapters/`` · each in its own file. Adding a
new provider/modality combo = one new file, no edits to the gateway.

Reference:
- MODEL-GATEWAY.html § 3.2 (this file)
- ADR 0021 self-explanation — adapters surface structured errors via
  ImageProviderError / VideoProviderError / etc.
"""

from __future__ import annotations

from typing import Any, ClassVar, Protocol, runtime_checkable

from allhands.core.modality import Modality
from allhands.core.model import LLMModel
from allhands.core.provider import LLMProvider


@runtime_checkable
class ModelAdapter(Protocol):
    """Base shape every adapter implements."""

    modality: ClassVar[Modality]
    provider_kinds: ClassVar[tuple[str, ...]]
    model_patterns: ClassVar[tuple[str, ...]]

    async def supports(self, *, provider: LLMProvider, model: LLMModel) -> bool: ...


def _default_supports(adapter: ModelAdapter, *, provider: LLMProvider, model: LLMModel) -> bool:
    """Default implementation usable from concrete adapters via composition.

    Provider kind must be in the adapter's allowlist AND the model name must
    contain at least one of the registered patterns. Adapters with stricter
    rules (capability negotiation · region-aware routing) override this.
    """
    if provider.kind not in adapter.provider_kinds:
        return False
    return any(pat in model.name for pat in adapter.model_patterns)


@runtime_checkable
class ImageAdapter(ModelAdapter, Protocol):
    """Image-modality adapter · used by Gateway.generate_image."""

    modality: ClassVar[Modality] = Modality.IMAGE

    async def generate(
        self,
        request: Any,  # core.image.ImageGenerationRequest
        *,
        provider: LLMProvider,
        model: LLMModel,
    ) -> Any: ...  # core.image.ImageGenerationResult


@runtime_checkable
class VideoAdapter(ModelAdapter, Protocol):
    """Video-modality adapter · used by Gateway.generate_video.

    Long-running generation (Sora / Veo / Wanx-Video typically take 30s-5min)
    is handled inside the adapter via internal polling; the gateway and tool
    layer see the same async-generate contract as the image adapter.
    """

    modality: ClassVar[Modality] = Modality.VIDEO

    async def generate(
        self,
        request: Any,
        *,
        provider: LLMProvider,
        model: LLMModel,
    ) -> Any: ...


@runtime_checkable
class AudioAdapter(ModelAdapter, Protocol):
    """Audio-modality adapter · TTS or STT decided by the request type."""

    modality: ClassVar[Modality] = Modality.AUDIO

    async def generate(
        self,
        request: Any,
        *,
        provider: LLMProvider,
        model: LLMModel,
    ) -> Any: ...


@runtime_checkable
class EmbeddingAdapter(ModelAdapter, Protocol):
    """Embedding adapter · text → vector.

    Different verb (`embed` vs `generate`) because the modality is producing
    structured data, not media bytes. Keeps the type system honest.
    """

    modality: ClassVar[Modality] = Modality.EMBEDDING

    async def embed(
        self,
        request: Any,
        *,
        provider: LLMProvider,
        model: LLMModel,
    ) -> Any: ...


__all__ = [
    "AudioAdapter",
    "EmbeddingAdapter",
    "ImageAdapter",
    "ModelAdapter",
    "VideoAdapter",
    "_default_supports",
]
