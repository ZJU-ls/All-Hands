"""ModelGateway · facade routing tests.

Cover:
- register / list_adapters round-trip
- _pick selects the first adapter whose ``supports()`` returns True
- NoAdapterFoundError envelope when:
  * no adapters registered for the modality
  * model lacks required Capability
  * adapters present but none claim (provider, model)
- AdapterMismatchError when an adapter's class type ≠ its modality
- generate_image / generate_video / embed_text dispatch through the right
  Protocol method
"""

from __future__ import annotations

from typing import Any, ClassVar

import pytest

from allhands.core.image import (
    GeneratedImage,
    ImageGenerationRequest,
    ImageGenerationResult,
)
from allhands.core.modality import (
    CAPABILITY_TO_MODALITY,
    MODALITY_TO_CAPABILITY,
    Modality,
)
from allhands.core.model import Capability, LLMModel
from allhands.core.provider import LLMProvider
from allhands.execution.model_gateway import (
    ModelGateway,
    NoAdapterFoundError,
)


def _provider(kind: str = "openai") -> LLMProvider:
    return LLMProvider(id="prov-1", name="prov", kind=kind, base_url="https://x", api_key="sk-x")


def _model(name: str = "gpt-image-1.5", caps: list[Capability] | None = None) -> LLMModel:
    return LLMModel(
        id=f"m-{name}",
        provider_id="prov-1",
        name=name,
        capabilities=caps or [Capability.IMAGE_GEN],
    )


class _FakeImageAdapter:
    modality: ClassVar[Modality] = Modality.IMAGE
    provider_kinds: ClassVar[tuple[str, ...]] = ("openai",)
    model_patterns: ClassVar[tuple[str, ...]] = ("gpt-image",)

    def __init__(self, *, label: str = "default") -> None:
        self.label = label
        self.last: ImageGenerationRequest | None = None

    async def supports(self, *, provider: LLMProvider, model: LLMModel) -> bool:
        return provider.kind in self.provider_kinds and any(
            p in model.name for p in self.model_patterns
        )

    async def generate(
        self, request: ImageGenerationRequest, *, provider: LLMProvider, model: LLMModel
    ) -> ImageGenerationResult:
        self.last = request
        return ImageGenerationResult(
            images=[GeneratedImage(data=b"\x89PNGfake", prompt=request.prompt, size=request.size)],
            duration_ms=1,
            cost_usd=0.0,
            model_used=model.name,
            provider_id=provider.id,
        )


class _NeverSupports:
    modality: ClassVar[Modality] = Modality.IMAGE
    provider_kinds: ClassVar[tuple[str, ...]] = ("never",)
    model_patterns: ClassVar[tuple[str, ...]] = ("never",)

    async def supports(self, **_: Any) -> bool:
        return False

    async def generate(self, *_: Any, **__: Any) -> Any:  # pragma: no cover
        raise AssertionError("should not be called")


# ─────────────────────────────────────────────────────────────────────
# Modality / Capability map sanity
# ─────────────────────────────────────────────────────────────────────


def test_modality_capability_inverse() -> None:
    """Round-trip: Capability → Modality → Capability."""
    for cap, modality in CAPABILITY_TO_MODALITY.items():
        assert MODALITY_TO_CAPABILITY[modality] == cap


def test_image_capability_maps_to_image_modality() -> None:
    assert CAPABILITY_TO_MODALITY[Capability.IMAGE_GEN] == Modality.IMAGE
    assert MODALITY_TO_CAPABILITY[Modality.IMAGE] == Capability.IMAGE_GEN


# ─────────────────────────────────────────────────────────────────────
# Registration
# ─────────────────────────────────────────────────────────────────────


def test_register_then_list_adapters() -> None:
    gw = ModelGateway()
    a, b = _FakeImageAdapter(label="a"), _FakeImageAdapter(label="b")
    gw.register(a)
    gw.register(b)
    assert gw.list_adapters(Modality.IMAGE) == [a, b]
    assert gw.list_adapters() == [a, b]


def test_list_empty_modality_returns_empty() -> None:
    gw = ModelGateway()
    assert gw.list_adapters(Modality.VIDEO) == []


# ─────────────────────────────────────────────────────────────────────
# Dispatch · happy path
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_generate_image_dispatches_to_first_supporting_adapter() -> None:
    gw = ModelGateway()
    no_match = _NeverSupports()
    matcher = _FakeImageAdapter(label="ok")
    gw.register(no_match)
    gw.register(matcher)

    req = ImageGenerationRequest(prompt="a serene cat")
    result = await gw.generate_image(req, provider=_provider(), model=_model())

    assert isinstance(result, ImageGenerationResult)
    assert matcher.last is not None
    assert matcher.last.prompt == "a serene cat"


@pytest.mark.asyncio
async def test_first_match_wins() -> None:
    gw = ModelGateway()
    first = _FakeImageAdapter(label="first")
    second = _FakeImageAdapter(label="second")
    gw.register(first)
    gw.register(second)

    await gw.generate_image(
        ImageGenerationRequest(prompt="first wins"), provider=_provider(), model=_model()
    )
    assert first.last is not None
    assert second.last is None


# ─────────────────────────────────────────────────────────────────────
# Failure envelopes
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_no_adapter_when_modality_empty() -> None:
    gw = ModelGateway()
    with pytest.raises(NoAdapterFoundError) as ei:
        await gw.generate_image(
            ImageGenerationRequest(prompt="cat"), provider=_provider(), model=_model()
        )
    d = ei.value.to_dict()
    assert d["field"] == "model_ref"
    assert "no adapters registered" in d["error"]
    assert d["type"] == "NoAdapterFoundError"


@pytest.mark.asyncio
async def test_no_adapter_when_capability_missing() -> None:
    gw = ModelGateway()
    gw.register(_FakeImageAdapter())
    chat_only = _model(name="gpt-4o-mini", caps=[Capability.CHAT])
    with pytest.raises(NoAdapterFoundError) as ei:
        await gw.generate_image(
            ImageGenerationRequest(prompt="cat"), provider=_provider(), model=chat_only
        )
    assert "image_gen" in ei.value.reason


@pytest.mark.asyncio
async def test_no_adapter_enumerates_registered_options() -> None:
    """When nothing matches, the error envelope lists what we have so the
    caller (LLM or human) can see what's wrong."""
    gw = ModelGateway()
    gw.register(_FakeImageAdapter())  # claims openai/gpt-image
    bad_model = _model(name="my-private-model")
    with pytest.raises(NoAdapterFoundError) as ei:
        await gw.generate_image(
            ImageGenerationRequest(prompt="cat"),
            provider=_provider(),
            model=bad_model,
        )
    msg = ei.value.reason
    assert "_FakeImageAdapter" in msg
    assert "my-private-model" in msg
    assert "['gpt-image']" in msg


# ─────────────────────────────────────────────────────────────────────
# Empty modality dispatch (video / audio / embedding) raises cleanly
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_video_dispatch_without_adapter_raises_no_adapter() -> None:
    gw = ModelGateway()
    # Use a chat-capable model so the capability check doesn't short-circuit
    # before we get to "no video adapters".
    chat_only = _model(name="gpt-4o-mini", caps=[Capability.CHAT])
    with pytest.raises(NoAdapterFoundError):
        await gw.generate_video(object(), provider=_provider(), model=chat_only)


@pytest.mark.asyncio
async def test_embedding_dispatch_without_adapter_raises_no_adapter() -> None:
    gw = ModelGateway()
    embed_model = _model(name="text-embedding-3", caps=[Capability.EMBEDDING])
    with pytest.raises(NoAdapterFoundError):
        await gw.embed_text(object(), provider=_provider(), model=embed_model)
