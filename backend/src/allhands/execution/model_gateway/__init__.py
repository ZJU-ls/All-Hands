"""ModelGateway · single facade for every modality (text/image/video/audio/embedding).

Architecture (MODEL-GATEWAY.html § 2):

    tool layer (generate_image / generate_video / chat_completion / embed_text)
      │
      ▼
    ModelGateway · routes by (modality, provider, model) → adapter
      │
      ├── ImageAdapter[]  · OpenAI gpt-image / DashScope wanx / Imagen / FLUX
      ├── VideoAdapter[]  · Veo / Wanx-video / Sora / Kling           (after A6)
      ├── AudioAdapter[]  · OpenAI TTS / DashScope cosyvoice / Whisper (after A6)
      └── EmbeddingAdapter[] · text-embedding-3 / wanx-embedding       (after A6)

The Gateway *does not* speak any wire format — that's the adapter's job.
The Gateway routes + cross-cuts (cost ledger / rate limit / retry / fallback,
all delivered as middleware in later phases · D5 design decision).

Why a single facade vs. per-modality gateways:
- One bootstrap point in ``api/deps.py`` · register all adapters once.
- Tool layer asks the gateway by modality · doesn't import adapter classes.
- Adding a provider = 1 file in adapters/ + 1 register line · done.
- Mirrors LiteLLM (single client) and Vercel AI SDK 6 (one interface for
  text/image/video) — the proven shape.

Reference:
- MODEL-GATEWAY.html § 3.3 (this file)
- ADR 0021 self-explanation — adapters raise structured errors with hint
"""

from __future__ import annotations

from collections import defaultdict

from allhands.core.modality import MODALITY_TO_CAPABILITY, Modality
from allhands.core.model import Capability, LLMModel
from allhands.core.provider import LLMProvider

from .base import (
    AudioAdapter,
    EmbeddingAdapter,
    ImageAdapter,
    ModelAdapter,
    VideoAdapter,
)
from .exceptions import (
    AdapterMismatchError,
    ModelGatewayError,
    NoAdapterFoundError,
)


class ModelGateway:
    """Adapter registry + dispatcher · single entry point for all modalities.

    Lifecycle:
      1. Construct empty.
      2. ``register(adapter)`` · usually at app boot in ``api/deps.py``.
      3. Tool layer calls ``generate_image(req, provider=..., model=...)`` /
         ``generate_video(...)`` etc.
      4. Internally we look up adapters for the requested modality, ask each
         ``adapter.supports(provider, model)`` until one returns True, then
         delegate ``adapter.generate(req, ...)``.

    Selection policy (D3 in MODEL-GATEWAY.html):
      - First-match wins · adapters can be re-ordered at registration time.
      - Default base impl in ``base.py`` does a fast static check against
        ``provider_kinds`` + ``model_patterns`` so most adapters get free
        ``supports()`` without subclass code.
      - Adapters can override ``supports()`` for fancier routing
        (e.g. region-based · capability negotiation).
    """

    def __init__(self) -> None:
        self._by_modality: dict[Modality, list[ModelAdapter]] = defaultdict(list)

    def register(self, adapter: ModelAdapter) -> None:
        """Register an adapter for its declared modality."""
        self._by_modality[adapter.modality].append(adapter)

    def list_adapters(self, modality: Modality | None = None) -> list[ModelAdapter]:
        """Read-only view (testing / diagnostics)."""
        if modality is not None:
            return list(self._by_modality.get(modality, []))
        return [a for adapters in self._by_modality.values() for a in adapters]

    # ─────────────────────────────────────────────────────────────────
    # Public dispatch — one method per modality. Tool layer calls these.
    # ─────────────────────────────────────────────────────────────────

    async def generate_image(
        self,
        request: object,  # core.image.ImageGenerationRequest · forward-decl to avoid cycle
        *,
        provider: LLMProvider,
        model: LLMModel,
    ) -> object:
        adapter = await self._pick(Modality.IMAGE, provider=provider, model=model)
        if not isinstance(adapter, ImageAdapter):
            raise AdapterMismatchError(
                f"adapter {adapter!r} declared image modality but isn't ImageAdapter"
            )
        return await adapter.generate(request, provider=provider, model=model)

    async def generate_video(
        self,
        request: object,  # core.video.VideoGenerationRequest · added in A6
        *,
        provider: LLMProvider,
        model: LLMModel,
    ) -> object:
        adapter = await self._pick(Modality.VIDEO, provider=provider, model=model)
        if not isinstance(adapter, VideoAdapter):
            raise AdapterMismatchError(
                f"adapter {adapter!r} declared video modality but isn't VideoAdapter"
            )
        return await adapter.generate(request, provider=provider, model=model)

    async def generate_audio(
        self,
        request: object,
        *,
        provider: LLMProvider,
        model: LLMModel,
    ) -> object:
        adapter = await self._pick(Modality.AUDIO, provider=provider, model=model)
        if not isinstance(adapter, AudioAdapter):
            raise AdapterMismatchError(
                f"adapter {adapter!r} declared audio modality but isn't AudioAdapter"
            )
        return await adapter.generate(request, provider=provider, model=model)

    async def embed_text(
        self,
        request: object,
        *,
        provider: LLMProvider,
        model: LLMModel,
    ) -> object:
        adapter = await self._pick(Modality.EMBEDDING, provider=provider, model=model)
        if not isinstance(adapter, EmbeddingAdapter):
            raise AdapterMismatchError(
                f"adapter {adapter!r} declared embedding modality but isn't EmbeddingAdapter"
            )
        return await adapter.embed(request, provider=provider, model=model)

    # ─────────────────────────────────────────────────────────────────
    # Internal · adapter selection
    # ─────────────────────────────────────────────────────────────────

    async def _pick(
        self,
        modality: Modality,
        *,
        provider: LLMProvider,
        model: LLMModel,
    ) -> ModelAdapter:
        # Capability check first — give the best self-explanation envelope.
        required = MODALITY_TO_CAPABILITY.get(modality)
        if required is not None and required not in {
            Capability(c) for c in (model.capabilities or [Capability.CHAT])
        }:
            raise NoAdapterFoundError(
                modality=modality,
                provider=provider.kind,
                model=model.name,
                reason=(
                    f"model {model.name!r} doesn't declare capability "
                    f"{required.value!r}; mark it in /settings/providers."
                ),
            )

        candidates = self._by_modality.get(modality, [])
        if not candidates:
            raise NoAdapterFoundError(
                modality=modality,
                provider=provider.kind,
                model=model.name,
                reason=f"no adapters registered for modality {modality.value!r}",
            )

        for adapter in candidates:
            if await adapter.supports(provider=provider, model=model):
                return adapter

        # No match · enumerate what we have so the LLM/log can self-correct.
        seen = ", ".join(
            f"{a.__class__.__name__}(kinds={list(a.provider_kinds)},"
            f" patterns={list(a.model_patterns)})"
            for a in candidates
        )
        raise NoAdapterFoundError(
            modality=modality,
            provider=provider.kind,
            model=model.name,
            reason=(
                f"no {modality.value} adapter accepts (provider.kind={provider.kind!r},"
                f" model.name={model.name!r}). Registered: {seen}"
            ),
        )


def build_default_gateway() -> ModelGateway:
    """Process-singleton factory · register every shipped adapter once.

    Adding a new adapter = one new file in ``adapters/`` + one ``register``
    line here. Tool layer / REST endpoints / UI testing dialog all light
    up automatically as long as the model row carries the right capability.
    """
    from .adapters import (
        DashScopeAudioAdapter,
        DashScopeImageAdapter,
        DashScopeVideoAdapter,
        OpenAIImageAdapter,
    )

    gw = ModelGateway()
    # Image
    gw.register(OpenAIImageAdapter())
    gw.register(DashScopeImageAdapter())
    # Video
    gw.register(DashScopeVideoAdapter())
    # Audio (TTS)
    gw.register(DashScopeAudioAdapter())
    return gw


__all__ = [
    "AdapterMismatchError",
    "AudioAdapter",
    "EmbeddingAdapter",
    "ImageAdapter",
    "ModelAdapter",
    "ModelGateway",
    "ModelGatewayError",
    "NoAdapterFoundError",
    "VideoAdapter",
    "build_default_gateway",
]
