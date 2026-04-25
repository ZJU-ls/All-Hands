"""End-to-end flow for /api/artifacts (Wave C · artifacts-skill § 5 / § 11)."""

from __future__ import annotations

import asyncio
import base64
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from allhands.api import create_app
from allhands.api.deps import get_artifact_service, get_session
from allhands.core import ArtifactKind
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlArtifactRepo
from allhands.services.artifact_service import ArtifactService


async def _init_schema(engine: AsyncEngine) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


@pytest.fixture
def maker_and_dir(tmp_path: Path) -> tuple[async_sessionmaker[AsyncSession], Path]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    asyncio.run(_init_schema(engine))
    return async_sessionmaker(engine, expire_on_commit=False), tmp_path


@pytest.fixture
def client(maker_and_dir: tuple[async_sessionmaker[AsyncSession], Path]) -> TestClient:
    maker, data_dir = maker_and_dir

    async def _session() -> AsyncIterator[AsyncSession]:
        async with maker() as s:
            yield s

    async def _svc_override() -> AsyncIterator[ArtifactService]:
        async with maker() as s:
            yield ArtifactService(SqlArtifactRepo(s), data_dir)

    app = create_app()
    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_artifact_service] = _svc_override
    return TestClient(app)


def _seed_markdown(
    maker_and_dir: tuple[async_sessionmaker[AsyncSession], Path],
) -> str:
    maker, data_dir = maker_and_dir

    async def _go() -> str:
        async with maker() as s:
            svc = ArtifactService(SqlArtifactRepo(s), data_dir)
            art = await svc.create(
                name="proposal",
                kind=ArtifactKind.MARKDOWN,
                content="# Proposal\n\nv1 content",
            )
            return art.id

    return asyncio.run(_go())


def _update_markdown(
    maker_and_dir: tuple[async_sessionmaker[AsyncSession], Path],
    artifact_id: str,
    content: str,
) -> None:
    maker, data_dir = maker_and_dir

    async def _go() -> None:
        async with maker() as s:
            svc = ArtifactService(SqlArtifactRepo(s), data_dir)
            await svc.update(artifact_id, mode="overwrite", content=content)

    asyncio.run(_go())


def _seed_image(maker_and_dir: tuple[async_sessionmaker[AsyncSession], Path], png: bytes) -> str:
    maker, data_dir = maker_and_dir

    async def _go() -> str:
        async with maker() as s:
            svc = ArtifactService(SqlArtifactRepo(s), data_dir)
            art = await svc.create(
                name="logo.png",
                kind=ArtifactKind.IMAGE,
                content_base64=base64.b64encode(png).decode("ascii"),
                mime_type="image/png",
            )
            return art.id

    return asyncio.run(_go())


def test_list_returns_seeded_artifact(
    client: TestClient,
    maker_and_dir: tuple[async_sessionmaker[AsyncSession], Path],
) -> None:
    artifact_id = _seed_markdown(maker_and_dir)
    resp = client.get("/api/artifacts")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["id"] == artifact_id
    assert items[0]["kind"] == "markdown"
    assert items[0]["version"] == 1


def test_get_content_returns_markdown_body(
    client: TestClient,
    maker_and_dir: tuple[async_sessionmaker[AsyncSession], Path],
) -> None:
    artifact_id = _seed_markdown(maker_and_dir)
    resp = client.get(f"/api/artifacts/{artifact_id}/content")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/markdown")
    assert "# Proposal" in resp.text


def test_get_missing_artifact_404(client: TestClient) -> None:
    resp = client.get("/api/artifacts/does-not-exist")
    assert resp.status_code == 404


def test_kind_filter_rejects_unknown(client: TestClient) -> None:
    resp = client.get("/api/artifacts", params={"kind": "nonsense"})
    assert resp.status_code == 400


def test_update_flow_bumps_version_and_exposes_history(
    client: TestClient,
    maker_and_dir: tuple[async_sessionmaker[AsyncSession], Path],
) -> None:
    artifact_id = _seed_markdown(maker_and_dir)
    _update_markdown(maker_and_dir, artifact_id, "# Proposal\n\nv2 content")

    detail = client.get(f"/api/artifacts/{artifact_id}").json()
    assert detail["version"] == 2

    versions = client.get(f"/api/artifacts/{artifact_id}/versions").json()
    assert [v["version"] for v in versions] == [2, 1]

    v1_body = client.get(f"/api/artifacts/{artifact_id}/versions/1/content").json()
    assert "v1 content" in (v1_body["content"] or "")
    v2_body = client.get(f"/api/artifacts/{artifact_id}/versions/2/content").json()
    assert "v2 content" in (v2_body["content"] or "")


def test_binary_content_round_trip(
    client: TestClient,
    maker_and_dir: tuple[async_sessionmaker[AsyncSession], Path],
) -> None:
    png = b"\x89PNG\r\n\x1a\n" + b"\x00\x11\x22\x33" * 4
    image_id = _seed_image(maker_and_dir, png)

    resp = client.get(f"/api/artifacts/{image_id}/content")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.content == png

    versioned = client.get(f"/api/artifacts/{image_id}/versions/1/content").json()
    assert versioned["content_base64"] is not None
    assert base64.b64decode(versioned["content_base64"]) == png
