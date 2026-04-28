"""Real-API E2E · drive generate_image through OpenAI Images API.

Gate: requires ``OPENAI_API_KEY`` in env. Without it, every test in this
module is skipped with a helpful message. With it, real OpenAI tokens are
spent — the user explicitly asked for "用 LLM 进行测试 · 我不在意 token 和时间消耗".

Two test paths
--------------
1. **Direct provider call** · proves OpenAIImageProvider speaks the right
   wire format with the real OpenAI Images API. Round-trips one tiny
   `gpt-image-1.5-mini low 1024x1024` request (~ $0.011 each).

2. **Tool-layer fan-out** · invokes the `generate_image` executor with 3
   prompts. Validates artifact storage round-trip + cost estimation +
   parallel batch dispatch. Costs ~ $0.033.

Run with:

    OPENAI_API_KEY=sk-... uv run pytest \\
        tests/integration/test_image_generate_with_real_llm.py -vs

Tests log the artifact id + duration + dollar estimate so the user can
spot-check the saved PNG via /api/artifacts/<id>/content.

Override the model with ``ALLHANDS_E2E_IMAGE_MODEL``; default tries the
cheapest gpt-image-1.5-mini.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from allhands.core.image import ImageGenerationRequest, ImageQuality
from allhands.execution.image_provider import OpenAIImageProvider
from allhands.execution.tools.builtin.image_generate import make_executor
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlArtifactRepo
from allhands.services.artifact_service import ArtifactService

pytestmark = pytest.mark.skipif(
    not os.environ.get("OPENAI_API_KEY"),
    reason=(
        "OPENAI_API_KEY not set · skipping real-API image gen E2E. Export the "
        "key and re-run to validate end-to-end against OpenAI Images."
    ),
)


DEFAULT_MODEL = os.environ.get("ALLHANDS_E2E_IMAGE_MODEL", "gpt-image-1.5-mini")
DEFAULT_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")


@pytest.fixture
def real_provider() -> OpenAIImageProvider:
    return OpenAIImageProvider(
        api_key=os.environ["OPENAI_API_KEY"],
        base_url=DEFAULT_BASE_URL,
        model_name=DEFAULT_MODEL,
        provider_id="openai",
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


# ─────────────────────────────────────────────────────────────────────
# 1) Direct provider call · proves wire format works against real API
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_real_openai_one_shot(
    real_provider: OpenAIImageProvider, capsys: pytest.CaptureFixture[str]
) -> None:
    req = ImageGenerationRequest(
        prompt="a tiny cute robot waving · flat illustration · centered",
        size="1024x1024",
        quality=ImageQuality.LOW,
    )
    result = await real_provider.generate(req)

    print(
        f"\n[real-OpenAI] model={result.model_used} · {result.duration_ms}ms · "
        f"images={len(result.images)} · est cost=${result.cost_usd}"
    )
    assert len(result.images) == 1
    img = result.images[0]
    assert img.mime_type in {"image/png", "image/jpeg", "image/webp"}
    # PNG magic bytes — proves real bytes were returned
    assert img.data[:4] in (b"\x89PNG", b"\xff\xd8\xff\xe0", b"\xff\xd8\xff\xe1", b"RIFF")
    assert len(img.data) > 1000  # > 1KB · not a placeholder


# ─────────────────────────────────────────────────────────────────────
# 2) Tool-layer fan-out · 3 prompts · proves batch parallelism + storage
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_real_openai_batch_through_tool(
    real_provider: OpenAIImageProvider,
    artifact_service: ArtifactService,
    capsys: pytest.CaptureFixture[str],
) -> None:
    executor = make_executor(
        provider_factory=lambda _ref: real_provider,
        artifact_service=artifact_service,
        conversation_id="real-llm-test",
        employee_id="real-llm-tester",
    )
    out = await executor(
        prompts=[
            "a serene mountain at dawn · flat illustration",
            "a quiet forest path · watercolor style",
            "a glowing city skyline at night · neon cyberpunk",
        ],
        size="1024x1024",
        quality="low",
    )

    print(
        f"\n[real-OpenAI batch] images={len(out['images'])} · "
        f"est cost=${out['total_cost_usd']} · "
        f"duration={out['duration_ms']}ms"
    )
    for i, img in enumerate(out["images"]):
        if "error" in img:
            print(f"  [{i}] ERROR: {img.get('error')}")
            continue
        print(f"  [{i}] {img['prompt'][:40]}... → {img['url']}")

    assert "error" not in out
    assert len(out["images"]) == 3
    # All three saved as artifacts
    success_ids = [img["artifact_id"] for img in out["images"] if "artifact_id" in img]
    assert len(success_ids) == 3, out

    # Round-trip · pull one back from storage
    art = await artifact_service.get(success_ids[0])
    assert art is not None
    assert art.kind.value == "image"
    assert art.size_bytes > 1000
    assert art.extra_metadata.get("image_gen") is True
    assert art.extra_metadata.get("model") == DEFAULT_MODEL
