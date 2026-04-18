"""ArtifactService unit tests (Wave C · artifacts-skill spec § 11)."""

from __future__ import annotations

import base64
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from allhands.core import ArtifactKind
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlArtifactRepo
from allhands.services.artifact_service import (
    ArtifactError,
    ArtifactNotFound,
    ArtifactService,
)


@pytest.fixture
async def session() -> AsyncSession:  # type: ignore[misc]
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    return tmp_path / "artifacts"


def _svc(session: AsyncSession, data_dir: Path) -> ArtifactService:
    return ArtifactService(SqlArtifactRepo(session), data_dir)


async def test_create_text_then_read_back(session: AsyncSession, data_dir: Path) -> None:
    svc = _svc(session, data_dir)
    art = await svc.create(
        name="spec-draft",
        kind=ArtifactKind.MARKDOWN,
        content="# Hello\n\nworld.\n",
    )
    assert art.version == 1
    assert art.size_bytes > 0
    assert art.mime_type == "text/markdown"

    same = await svc.get(art.id)
    assert same.content == "# Hello\n\nworld.\n"
    assert same.file_path is None


async def test_create_rejects_missing_content(session: AsyncSession, data_dir: Path) -> None:
    svc = _svc(session, data_dir)
    with pytest.raises(ArtifactError):
        await svc.create(name="empty", kind=ArtifactKind.MARKDOWN)


async def test_update_overwrite_bumps_version_and_keeps_history(
    session: AsyncSession, data_dir: Path
) -> None:
    svc = _svc(session, data_dir)
    art = await svc.create(name="plan", kind=ArtifactKind.MARKDOWN, content="first draft")
    updated = await svc.update(art.id, mode="overwrite", content="second draft")
    assert updated.version == 2
    assert updated.content == "second draft"

    versions = await svc.list_versions(art.id)
    assert [v.version for v in versions] == [2, 1]

    v1 = await svc.read_version(art.id, 1)
    assert v1.content == "first draft"


async def test_update_patch_applies_unified_diff(session: AsyncSession, data_dir: Path) -> None:
    svc = _svc(session, data_dir)
    art = await svc.create(
        name="doc",
        kind=ArtifactKind.MARKDOWN,
        content="line a\nline b\nline c\n",
    )
    patch = "--- a\n+++ b\n@@ -1,3 +1,3 @@\n line a\n-line b\n+line B!\n line c\n"
    updated = await svc.update(art.id, mode="patch", patch=patch)
    assert updated.content == "line a\nline B!\nline c\n"
    assert updated.version == 2


async def test_update_rejects_unknown_id(session: AsyncSession, data_dir: Path) -> None:
    svc = _svc(session, data_dir)
    with pytest.raises(ArtifactNotFound):
        await svc.update("nope", content="x")


async def test_delete_hides_from_list_but_versions_remain(
    session: AsyncSession, data_dir: Path
) -> None:
    svc = _svc(session, data_dir)
    art = await svc.create(name="tmp", kind=ArtifactKind.CODE, content="x = 1\n")
    await svc.delete(art.id)

    live = await svc.list_all()
    assert art.id not in {a.id for a in live}

    with_deleted = await svc.list_all(include_deleted=True)
    assert art.id in {a.id for a in with_deleted}

    # Versions retained after soft-delete.
    versions = await svc.list_versions(art.id)
    assert len(versions) == 1


async def test_pin_toggles_and_keeps_pinned_on_top(session: AsyncSession, data_dir: Path) -> None:
    svc = _svc(session, data_dir)
    a = await svc.create(name="one", kind=ArtifactKind.MARKDOWN, content="a")
    b = await svc.create(name="two", kind=ArtifactKind.MARKDOWN, content="b")

    pinned_b = await svc.set_pinned(b.id, True)
    assert pinned_b.pinned is True

    listed = await svc.list_all()
    assert listed[0].id == b.id  # pinned on top regardless of recency
    assert a.id in {x.id for x in listed}


async def test_search_matches_name_and_content(session: AsyncSession, data_dir: Path) -> None:
    svc = _svc(session, data_dir)
    await svc.create(name="login-redesign", kind=ArtifactKind.MARKDOWN, content="TBD")
    await svc.create(name="billing", kind=ArtifactKind.MARKDOWN, content="redesign plan")
    hits = await svc.search("redesign")
    assert len(hits) == 2


async def test_create_image_writes_binary_file(session: AsyncSession, data_dir: Path) -> None:
    svc = _svc(session, data_dir)
    png_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
    art = await svc.create(
        name="logo",
        kind=ArtifactKind.IMAGE,
        content_base64=base64.b64encode(png_bytes).decode("ascii"),
        mime_type="image/png",
    )
    assert art.content is None
    assert art.file_path is not None
    assert art.size_bytes == len(png_bytes)
    assert svc.read_binary(art) == png_bytes


async def test_update_binary_rejects_patch(session: AsyncSession, data_dir: Path) -> None:
    svc = _svc(session, data_dir)
    png_bytes = b"\x89PNG" + b"\x00" * 8
    art = await svc.create(
        name="logo2",
        kind=ArtifactKind.IMAGE,
        content_base64=base64.b64encode(png_bytes).decode("ascii"),
        mime_type="image/png",
    )
    with pytest.raises(ArtifactError):
        await svc.update(art.id, mode="patch", patch="--- a\n+++ b\n")


async def test_create_name_regex(session: AsyncSession, data_dir: Path) -> None:
    svc = _svc(session, data_dir)
    # CJK is allowed per spec.
    art = await svc.create(name="春季计划 v2", kind=ArtifactKind.MARKDOWN, content="hi")
    assert art.name == "春季计划 v2"
    with pytest.raises(ArtifactError):
        await svc.create(name="bad/slash", kind=ArtifactKind.MARKDOWN, content="x")


async def test_text_size_ceiling_enforced(session: AsyncSession, data_dir: Path) -> None:
    svc = _svc(session, data_dir)
    too_big = "x" * (1_024 * 1_024 + 1)
    with pytest.raises(ArtifactError):
        await svc.create(name="huge", kind=ArtifactKind.CODE, content=too_big)
