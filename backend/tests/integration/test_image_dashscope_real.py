"""Real-API E2E · drive DashScope wanx through ModelGateway · spends real ¥.

Gate: requires ``ALLHANDS_DASHSCOPE_API_KEY`` env var, OR a Bailian (kind=
aliyun) provider configured in the DB at ``backend/data/app.db``. The
fixture transparently picks whichever is available; if both are missing
it skips with the cheapest-possible setup instructions.

Why a real test? The DashScope wire format (X-DashScope-Async header,
task-status state machine, result URL download) has multiple footguns
that mocks can hide. One real round-trip per CI run is the only way to
catch breakage early.

Cost per run: ~ ¥0.20 (one wanx2.1-t2i-turbo image at 1024x1024).
Wall clock: ~ 10-30s.

Run with:
    ALLHANDS_DASHSCOPE_API_KEY=sk-... uv run pytest \\
      tests/integration/test_image_dashscope_real.py -vs

Or with a populated app.db (the dev workflow):
    uv run pytest tests/integration/test_image_dashscope_real.py -vs
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from allhands.core.image import ImageGenerationRequest, ImageQuality
from allhands.core.model import Capability, LLMModel
from allhands.core.provider import LLMProvider
from allhands.execution.model_gateway import ModelGateway
from allhands.execution.model_gateway.adapters import DashScopeImageAdapter
from allhands.execution.tools.builtin.image_generate import make_gateway_executor
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlArtifactRepo
from allhands.services.artifact_service import ArtifactService

DEFAULT_MODEL = os.environ.get("ALLHANDS_E2E_DASHSCOPE_MODEL", "wanx2.1-t2i-turbo")
DEFAULT_BASE = os.environ.get(
    "ALLHANDS_E2E_DASHSCOPE_BASE", "https://dashscope.aliyuncs.com/api/v1"
)


def _resolve_dashscope_key() -> str | None:
    """Find a usable DashScope key · env var first, then app.db fallback."""
    env = os.environ.get("ALLHANDS_DASHSCOPE_API_KEY") or os.environ.get("DASHSCOPE_API_KEY")
    if env:
        return env
    db_path = Path(__file__).resolve().parents[2] / "data" / "app.db"
    if not db_path.is_file():
        return None
    try:
        con = sqlite3.connect(str(db_path))
        try:
            row = con.execute(
                "SELECT api_key FROM llm_providers WHERE kind='aliyun' "
                "AND length(api_key) > 10 LIMIT 1"
            ).fetchone()
            if row and row[0]:
                return str(row[0])
        finally:
            con.close()
    except sqlite3.Error:
        return None
    return None


_KEY = _resolve_dashscope_key()

pytestmark = pytest.mark.skipif(
    _KEY is None,
    reason=(
        "No DashScope key found. Set ALLHANDS_DASHSCOPE_API_KEY=sk-... or "
        "configure an aliyun-kind provider with an api_key in "
        "backend/data/app.db (the normal dev workflow)."
    ),
)


@pytest.fixture
def real_provider() -> LLMProvider:
    return LLMProvider(
        id="bailian-real",
        name="百炼(real)",
        kind="aliyun",
        base_url=DEFAULT_BASE,
        api_key=_KEY or "missing",
    )


@pytest.fixture
def real_model() -> LLMModel:
    return LLMModel(
        id="m-wanx",
        provider_id="bailian-real",
        name=DEFAULT_MODEL,
        capabilities=[Capability.IMAGE_GEN],
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


# ─────────────────────────────────────────────────────────────────────────
# 1) Direct adapter call · wire-format proof against the real API
# ─────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_real_dashscope_one_shot(
    real_provider: LLMProvider,
    real_model: LLMModel,
    capsys: pytest.CaptureFixture[str],
) -> None:
    adapter = DashScopeImageAdapter(poll_timeout_seconds=90, poll_interval_seconds=2)
    result = await adapter.generate(
        ImageGenerationRequest(
            prompt="a tiny robot waving hello · flat illustration · centered",
            size="1024x1024",
            quality=ImageQuality.AUTO,
        ),
        provider=real_provider,
        model=real_model,
    )

    print(
        f"\n[real-DashScope] model={result.model_used} · {result.duration_ms}ms · "
        f"{len(result.images)} image(s) · est ¥{result.cost_usd}"
    )
    assert len(result.images) >= 1
    img = result.images[0]
    assert img.mime_type in {"image/png", "image/jpeg", "image/webp"}
    # PNG / JPEG magic bytes — not a placeholder
    assert img.data[:4] in (
        b"\x89PNG",
        b"\xff\xd8\xff\xe0",
        b"\xff\xd8\xff\xe1",
        b"\xff\xd8\xff\xdb",
    )
    assert len(img.data) > 1000  # > 1KB · real image


# ─────────────────────────────────────────────────────────────────────────
# 2) Tool-layer through Gateway · proves the full chain works end-to-end
# ─────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_real_dashscope_through_gateway_and_artifact_store(
    real_provider: LLMProvider,
    real_model: LLMModel,
    artifact_service: ArtifactService,
    capsys: pytest.CaptureFixture[str],
) -> None:
    gw = ModelGateway()
    gw.register(DashScopeImageAdapter(poll_timeout_seconds=90, poll_interval_seconds=2))

    executor = make_gateway_executor(
        gateway=gw,
        resolve_provider_model=lambda _ref: (real_provider, real_model),
        artifact_service=artifact_service,
        conversation_id="real-dashscope-test",
        employee_id="real-dashscope-tester",
    )
    out = await executor(
        prompts=["a serene mountain at dawn · flat illustration"],
        size="1024x1024",
        quality="auto",
    )

    print(
        f"\n[real-DashScope through gateway] images={len(out['images'])} · "
        f"est ¥{out['total_cost_usd']} · duration={out['duration_ms']}ms"
    )
    for i, img in enumerate(out["images"]):
        if "error" in img:
            print(f"  [{i}] ERROR: {img['error']}")
            continue
        print(f"  [{i}] {img['prompt'][:40]}... → {img['url']}")

    assert "error" not in out
    assert len(out["images"]) == 1
    img = out["images"][0]
    assert "artifact_id" in img
    assert img["url"] == f"/api/artifacts/{img['artifact_id']}/content"

    # Round-trip · artifact is real and in storage
    art = await artifact_service.get(img["artifact_id"])
    assert art is not None
    assert art.kind.value == "image"
    assert art.size_bytes > 1000
    assert art.extra_metadata.get("model") == DEFAULT_MODEL
    assert art.extra_metadata.get("provider") == "bailian-real"
