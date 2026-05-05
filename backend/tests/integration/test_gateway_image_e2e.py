"""Gateway-flavored generate_image executor · drives the new chain end-to-end.

  prompts → ModelGateway.generate_image → (OpenAI|DashScope|Fake)ImageAdapter
       → ArtifactService.create(kind=image)
       → returns [{artifact_id, url, prompt}]

Cover:
- Real registry routing (OpenAIImageAdapter + DashScopeImageAdapter both
  registered) · OpenAI path used because the resolver picks an OpenAI model
- Gateway envelope when the model lacks Capability.IMAGE_GEN
- Gateway envelope when no adapter accepts the (provider, model) pair
- Same artifact persistence guarantees as the legacy executor (kind=image,
  metadata fields)
"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from allhands.core import ArtifactKind
from allhands.core.image import (
    GeneratedImage,
    ImageGenerationRequest,
    ImageGenerationResult,
)
from allhands.core.modality import Modality
from allhands.core.model import Capability, LLMModel
from allhands.core.provider import LLMProvider
from allhands.execution.model_gateway import ModelGateway
from allhands.execution.model_gateway.adapters import (
    DashScopeImageAdapter,
    OpenAIImageAdapter,
)
from allhands.execution.tools.builtin.image_generate import make_gateway_executor
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlArtifactRepo
from allhands.services.artifact_service import ArtifactService


class _CannedAdapter:
    """Test adapter · serves any (provider, model) · returns canned PNG bytes."""

    modality = Modality.IMAGE
    provider_kinds = ("aliyun",)
    model_patterns = ("",)

    def __init__(self) -> None:
        self.calls: list[ImageGenerationRequest] = []

    async def supports(self, *, provider: LLMProvider, model: LLMModel) -> bool:
        return provider.kind == "aliyun" and "canned" in model.name

    async def generate(
        self, request: ImageGenerationRequest, *, provider: LLMProvider, model: LLMModel
    ) -> ImageGenerationResult:
        self.calls.append(request)
        return ImageGenerationResult(
            images=[
                GeneratedImage(
                    data=b"\x89PNG\r\n\x1a\nFAKE",
                    mime_type="image/png",
                    prompt=request.prompt,
                    size=request.size,
                )
            ],
            duration_ms=42,
            cost_usd=0.0,
            model_used=model.name,
            provider_id=provider.id,
        )


@pytest.fixture
async def artifact_service(tmp_path: Path) -> ArtifactService:  # type: ignore[misc]
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield ArtifactService(SqlArtifactRepo(s), tmp_path / "artifacts")
    await engine.dispose()


def _provider() -> LLMProvider:
    return LLMProvider(
        id="prov-test", name="Test Provider", kind="aliyun", base_url="https://x", api_key="sk-x"
    )


def _model(caps: list[Capability] | None = None) -> LLMModel:
    return LLMModel(
        id="m-test",
        provider_id="prov-test",
        name="canned-image-1",
        capabilities=caps or [Capability.IMAGE_GEN],
    )


# ─────────────────────────────────────────────────────────────────────
# Happy path · gateway routes to canned adapter
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_gateway_executor_dispatches_through_canned_adapter(
    artifact_service: ArtifactService,
) -> None:
    gw = ModelGateway()
    adapter = _CannedAdapter()
    # Post-2026-05-05 the DashScope adapter accepts any aliyun image model
    # (we removed the name-substring filter), so it would shadow the
    # canned adapter for the test fixture below. Registering canned
    # FIRST keeps the previous-by-construction match: gateway uses
    # registration order and picks the first ``supports`` that returns
    # True. Both real adapters stay around as no-op decoys verifying the
    # routing doesn't pull them in.
    gw.register(adapter)
    gw.register(OpenAIImageAdapter())  # registered but never used
    gw.register(DashScopeImageAdapter(poll_interval_seconds=0.0))  # ditto

    provider, model = _provider(), _model()

    executor = make_gateway_executor(
        gateway=gw,
        resolve_provider_model=lambda _ref: (provider, model),
        artifact_service=artifact_service,
        conversation_id="c1",
        employee_id="e1",
    )
    out = await executor(prompts=["sunset over the lake"])

    assert "error" not in out
    assert len(out["images"]) == 1
    img = out["images"][0]
    assert img["url"] == f"/api/artifacts/{img['artifact_id']}/content"
    assert adapter.calls[0].prompt == "sunset over the lake"

    # Artifact really persisted with metadata
    art = await artifact_service.get(img["artifact_id"])
    assert art is not None
    assert art.kind == ArtifactKind.IMAGE
    assert art.extra_metadata["model"] == "canned-image-1"
    assert art.extra_metadata["provider"] == "prov-test"


@pytest.mark.asyncio
async def test_gateway_executor_concurrent_batch(
    artifact_service: ArtifactService,
) -> None:
    gw = ModelGateway()
    adapter = _CannedAdapter()
    gw.register(adapter)

    provider, model = _provider(), _model()
    executor = make_gateway_executor(
        gateway=gw,
        resolve_provider_model=lambda _ref: (provider, model),
        artifact_service=artifact_service,
    )
    out = await executor(prompts=["one", "two", "three", "four", "five"])
    assert len(out["images"]) == 5
    # Adapter called once per prompt
    assert len(adapter.calls) == 5


# ─────────────────────────────────────────────────────────────────────
# Failure paths · NoAdapterFoundError gives ADR 0021 envelope
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_gateway_envelope_when_no_adapter(
    artifact_service: ArtifactService,
) -> None:
    """Gateway routing error must surface as a per-prompt envelope, not a crash."""
    gw = ModelGateway()  # nothing registered
    provider, model = _provider(), _model()

    executor = make_gateway_executor(
        gateway=gw,
        resolve_provider_model=lambda _ref: (provider, model),
        artifact_service=artifact_service,
    )
    out = await executor(prompts=["oops"])
    assert len(out["images"]) == 1
    err = out["images"][0]
    # NoAdapterFoundError.to_dict() shape
    assert "error" in err
    assert err["field"] == "model_ref"


@pytest.mark.asyncio
async def test_gateway_envelope_when_capability_missing(
    artifact_service: ArtifactService,
) -> None:
    gw = ModelGateway()
    gw.register(_CannedAdapter())
    provider = _provider()
    chat_only = LLMModel(
        id="chat-only",
        provider_id="prov-test",
        name="chat-bot",
        capabilities=[Capability.CHAT],
    )

    executor = make_gateway_executor(
        gateway=gw,
        resolve_provider_model=lambda _ref: (provider, chat_only),
        artifact_service=artifact_service,
    )
    out = await executor(prompts=["a sunset"])
    assert "error" in out["images"][0]
    assert "image_gen" in out["images"][0]["error"]


# ─────────────────────────────────────────────────────────────────────
# Resolver itself can raise · we surface the exception's envelope
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_resolver_error_propagates(
    artifact_service: ArtifactService,
) -> None:
    gw = ModelGateway()
    gw.register(_CannedAdapter())

    def _bad_resolve(_ref: str | None) -> tuple[object, object]:
        raise RuntimeError("no image-capable model configured")

    executor = make_gateway_executor(
        gateway=gw,
        resolve_provider_model=_bad_resolve,
        artifact_service=artifact_service,
    )
    out = await executor(prompts=["x"])
    assert "error" in out
    assert "no image-capable" in out["error"] or "RuntimeError" in out["error"]
