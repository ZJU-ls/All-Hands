"""E2E · generate_image executor + real ArtifactService + Fake provider.

Walks the full chain that the LLM-bound tool will hit:
  prompts → (Fake)ImageProvider · gather → ArtifactService.create(kind=image)
  → returns [{artifact_id, url, prompt}]

Real-LLM exercise (gated on OPENAI_API_KEY) lives in
test_image_generate_with_real_llm.py.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from allhands.core import ArtifactKind
from allhands.execution.image_provider import (
    FakeImageProvider,
    ImageProvider,
    ImageProviderError,
)
from allhands.execution.tools.builtin.image_generate import (
    TOOL,
    make_executor,
)
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlArtifactRepo
from allhands.services.artifact_service import ArtifactService

# ─────────────────────────────────────────────────────────────────────────
# Tool stub assertions (ADR 0021 declarative shape)
# ─────────────────────────────────────────────────────────────────────────


def test_tool_stub_is_write_with_confirmation() -> None:
    assert TOOL.scope.value == "write"
    assert TOOL.requires_confirmation is True


def test_tool_stub_required_fields() -> None:
    schema = TOOL.input_schema
    assert "prompts" in schema["required"]


def test_tool_stub_max_batch_enforced_in_schema() -> None:
    schema = TOOL.input_schema["properties"]["prompts"]
    assert schema["maxItems"] == 10
    assert schema["minItems"] == 1


def test_tool_stub_quality_enum_lists_all_values() -> None:
    enum_vals = TOOL.input_schema["properties"]["quality"]["enum"]
    assert set(enum_vals) == {"auto", "low", "medium", "high"}


# ─────────────────────────────────────────────────────────────────────────
# Executor wiring helpers
# ─────────────────────────────────────────────────────────────────────────


@pytest.fixture
async def artifact_service(tmp_path: Path) -> ArtifactService:  # type: ignore[misc]
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield ArtifactService(SqlArtifactRepo(s), tmp_path / "artifacts")
    await engine.dispose()


@pytest.fixture
def fake_provider() -> FakeImageProvider:
    return FakeImageProvider(provider_id="fake", model_name="gpt-image-1.5")


def _build_executor(artifact_service: ArtifactService, provider: ImageProvider):  # type: ignore[no-untyped-def]
    return make_executor(
        provider_factory=lambda _ref: provider,
        artifact_service=artifact_service,
        conversation_id="conv-test",
        employee_id="emp-test",
    )


# ─────────────────────────────────────────────────────────────────────────
# Happy paths
# ─────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_single_prompt_generates_one_artifact(
    artifact_service: ArtifactService, fake_provider: FakeImageProvider
) -> None:
    executor = _build_executor(artifact_service, fake_provider)
    out = await executor(prompts=["a serene mountain at dawn"])

    assert "error" not in out
    assert len(out["images"]) == 1
    img = out["images"][0]
    assert img["artifact_id"]
    assert img["url"] == f"/api/artifacts/{img['artifact_id']}/content"
    assert img["mime_type"] == "image/png"
    assert img["prompt"] == "a serene mountain at dawn"


@pytest.mark.asyncio
async def test_batch_runs_concurrently(
    artifact_service: ArtifactService, fake_provider: FakeImageProvider
) -> None:
    """Sanity · batch returns N images aligned with N prompts."""
    executor = _build_executor(artifact_service, fake_provider)
    prompts = [
        "title page abstract",
        "section icon network",
        "section icon database",
        "section icon cloud",
        "team photo composite",
        "closing slide minimal",
    ]
    out = await executor(prompts=prompts)
    assert len(out["images"]) == 6
    assert fake_provider.call_count == 6
    # All artifacts saved · each has its own id
    ids = {img["artifact_id"] for img in out["images"]}
    assert len(ids) == 6
    # Cost estimate populated (gpt-image-1.5 medium / auto · 6 x $0.04)
    assert out["total_cost_usd"] is not None
    assert out["total_cost_usd"] > 0


@pytest.mark.asyncio
async def test_artifact_persisted_with_image_metadata(
    artifact_service: ArtifactService, fake_provider: FakeImageProvider
) -> None:
    executor = _build_executor(artifact_service, fake_provider)
    out = await executor(prompts=["a quiet forest"])
    art = await artifact_service.get(out["images"][0]["artifact_id"])
    assert art is not None
    assert art.kind == ArtifactKind.IMAGE
    assert art.extra_metadata.get("image_gen") is True
    assert art.extra_metadata.get("model") == "gpt-image-1.5"
    assert art.extra_metadata.get("prompt") == "a quiet forest"


# ─────────────────────────────────────────────────────────────────────────
# Validation envelopes (ADR 0021 self-explanation)
# ─────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_empty_prompts_returns_envelope(
    artifact_service: ArtifactService, fake_provider: FakeImageProvider
) -> None:
    executor = _build_executor(artifact_service, fake_provider)
    out = await executor(prompts=[])
    assert "error" in out
    assert out["field"] == "prompts"
    assert "1-10" in out.get("expected", "")


@pytest.mark.asyncio
async def test_too_many_prompts_envelope(
    artifact_service: ArtifactService, fake_provider: FakeImageProvider
) -> None:
    executor = _build_executor(artifact_service, fake_provider)
    out = await executor(prompts=["x"] * 20)
    assert "error" in out
    assert out["field"] == "prompts"
    assert "≤ 10" in out["expected"]


@pytest.mark.asyncio
async def test_unsupported_size_envelope(
    artifact_service: ArtifactService, fake_provider: FakeImageProvider
) -> None:
    executor = _build_executor(artifact_service, fake_provider)
    out = await executor(prompts=["cat"], size="9999x9999")
    assert "error" in out
    assert out["field"] == "size"


@pytest.mark.asyncio
async def test_unknown_quality_envelope(
    artifact_service: ArtifactService, fake_provider: FakeImageProvider
) -> None:
    executor = _build_executor(artifact_service, fake_provider)
    out = await executor(prompts=["cat"], quality="ultra-mega-nope")
    assert "error" in out
    assert out["field"] == "quality"


# ─────────────────────────────────────────────────────────────────────────
# Provider failures · partial success preserved
# ─────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_provider_error_propagates_envelope(
    artifact_service: ArtifactService,
) -> None:
    failing = FakeImageProvider(
        raises=ImageProviderError("boom", field="api_key", expected="non-empty")
    )
    executor = _build_executor(artifact_service, failing)
    out = await executor(prompts=["cat", "dog"])
    # All images collapse to envelopes (each prompt failed)
    assert all("error" in img for img in out["images"])


@pytest.mark.asyncio
async def test_provider_factory_error_returns_envelope(
    artifact_service: ArtifactService,
) -> None:
    def _bad_factory(_ref):
        raise ImageProviderError(
            "no image-capable model configured",
            field="model_ref",
            hint="register a model with image_gen capability",
        )

    executor = make_executor(
        provider_factory=_bad_factory,
        artifact_service=artifact_service,
    )
    out = await executor(prompts=["cat"])
    assert "no image-capable" in out["error"]
    assert out["field"] == "model_ref"


# ─────────────────────────────────────────────────────────────────────────
# Tool registered in default discover_builtin_tools
# ─────────────────────────────────────────────────────────────────────────


def test_image_generate_in_default_registry() -> None:
    from allhands.execution.registry import ToolRegistry
    from allhands.execution.tools import discover_builtin_tools

    reg = ToolRegistry()
    discover_builtin_tools(reg)
    ids = {t.id for t in reg.list_all()}
    assert "allhands.image.generate" in ids


def test_image_creator_skill_registered() -> None:
    from allhands.execution.skills import SkillRegistry, seed_skills

    reg = SkillRegistry()
    seed_skills(reg)
    s = reg.get_full("allhands.image-creator")
    assert s is not None
    assert "allhands.image.generate" in s.tool_ids
    # SKILL.yaml prompt fragment loaded (decision tree)
    assert s.prompt_fragment is not None
    assert "batch" in s.prompt_fragment.lower()
