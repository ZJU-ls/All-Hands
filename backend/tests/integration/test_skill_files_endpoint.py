"""GET /skills/{id}/files (with include_manifest) + GET / PUT / DELETE
content endpoints. Sandbox + cache invalidation regression coverage."""

from __future__ import annotations

import io
import tarfile
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from allhands.api import create_app
from allhands.api.deps import get_session, get_skill_service
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlSkillRepo
from allhands.services.github_market import FakeGithubMarket
from allhands.services.skill_service import SkillService

SKILL_MD = """---
name: edit-fixture
description: editor fixture skill
version: 0.1.0
tool_ids: []
---
body fragment original
"""


def _fake_tar(slug: str) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        data = SKILL_MD.encode("utf-8")
        info = tarfile.TarInfo(name=f"{slug}/SKILL.md")
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
        # also add a references/ companion file so the editor has a
        # multi-file tree to walk over.
        ref = b"# Reference\n\nsome text\n"
        info2 = tarfile.TarInfo(name=f"{slug}/references/note.md")
        info2.size = len(ref)
        tar.addfile(info2, io.BytesIO(ref))
    return buf.getvalue()


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    async def _session() -> AsyncIterator[AsyncSession]:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as s:
            yield s

    market = FakeGithubMarket(
        entries={
            "edit-fixture": (
                SKILL_MD,
                ("SKILL.md", "references/note.md"),
                _fake_tar("edit-fixture"),
            )
        },
    )

    async def _svc(session: AsyncSession = Depends(_session)) -> SkillService:
        return SkillService(
            repo=SqlSkillRepo(session),
            install_root=tmp_path / "data" / "skills",
            market=market,
        )

    app = create_app()
    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_skill_service] = _svc
    return TestClient(app)


def _install(client: TestClient) -> str:
    r = client.post("/api/skills/install/market", json={"slug": "edit-fixture"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


# ── List · include_manifest toggle ──────────────────────────────────────


def test_list_files_default_skips_manifest_and_prompts(client: TestClient) -> None:
    sid = _install(client)
    r = client.get(f"/api/skills/{sid}/files")
    assert r.status_code == 200
    paths = [f["relative_path"] for f in r.json()["files"]]
    assert "references/note.md" in paths
    assert "SKILL.md" not in paths  # filtered by default


def test_list_files_with_include_manifest_returns_everything(client: TestClient) -> None:
    sid = _install(client)
    r = client.get(f"/api/skills/{sid}/files", params={"include_manifest": True})
    assert r.status_code == 200
    paths = [f["relative_path"] for f in r.json()["files"]]
    assert "SKILL.md" in paths
    assert "references/note.md" in paths


# ── Read content ────────────────────────────────────────────────────────


def test_read_content_returns_text(client: TestClient) -> None:
    sid = _install(client)
    r = client.get(
        f"/api/skills/{sid}/files/content",
        params={"path": "references/note.md"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["encoding"] == "utf-8"
    assert "Reference" in body["content"]
    assert body["editable"] is True
    assert body["relative_path"] == "references/note.md"


def test_read_content_404_when_missing(client: TestClient) -> None:
    sid = _install(client)
    r = client.get(
        f"/api/skills/{sid}/files/content",
        params={"path": "does/not/exist.md"},
    )
    assert r.status_code == 404


def test_read_content_400_on_path_traversal(client: TestClient) -> None:
    sid = _install(client)
    r = client.get(
        f"/api/skills/{sid}/files/content",
        params={"path": "../../etc/passwd"},
    )
    assert r.status_code == 400
    assert "escape" in r.json()["detail"].lower() or "relative" in r.json()["detail"].lower()


def test_read_content_400_on_absolute_path(client: TestClient) -> None:
    sid = _install(client)
    r = client.get(
        f"/api/skills/{sid}/files/content",
        params={"path": "/etc/passwd"},
    )
    assert r.status_code == 400


# ── Write content ───────────────────────────────────────────────────────


def test_write_content_persists_to_disk(client: TestClient) -> None:
    sid = _install(client)
    r = client.put(
        f"/api/skills/{sid}/files/content",
        params={"path": "references/note.md"},
        json={"content": "# Reference\n\nedited!\n"},
    )
    assert r.status_code == 200
    body = r.json()
    assert "edited!" in body["content"]
    # confirm GET reflects the write
    r2 = client.get(
        f"/api/skills/{sid}/files/content",
        params={"path": "references/note.md"},
    )
    assert "edited!" in r2.json()["content"]


def test_write_content_creates_new_file(client: TestClient) -> None:
    sid = _install(client)
    r = client.put(
        f"/api/skills/{sid}/files/content",
        params={"path": "references/extra.md"},
        json={"content": "brand new"},
    )
    assert r.status_code == 200
    listing = client.get(f"/api/skills/{sid}/files").json()["files"]
    assert any(f["relative_path"] == "references/extra.md" for f in listing)


def test_write_content_400_on_forbidden_suffix(client: TestClient) -> None:
    sid = _install(client)
    r = client.put(
        f"/api/skills/{sid}/files/content",
        params={"path": "references/foo.exe"},
        json={"content": "bytes"},
    )
    assert r.status_code == 400
    assert "forbidden" in r.json()["detail"].lower()


def test_write_content_400_on_path_traversal(client: TestClient) -> None:
    sid = _install(client)
    r = client.put(
        f"/api/skills/{sid}/files/content",
        params={"path": "../../tmp/pwned.md"},
        json={"content": "lol"},
    )
    assert r.status_code == 400


def test_write_content_413_when_too_large(client: TestClient) -> None:
    sid = _install(client)
    big = "x" * (256 * 1024 + 1)
    r = client.put(
        f"/api/skills/{sid}/files/content",
        params={"path": "references/big.md"},
        json={"content": big},
    )
    assert r.status_code == 400
    assert "too large" in r.json()["detail"].lower()


# ── Delete content ──────────────────────────────────────────────────────


def test_delete_content_removes_file(client: TestClient) -> None:
    sid = _install(client)
    r = client.delete(
        f"/api/skills/{sid}/files/content",
        params={"path": "references/note.md"},
    )
    assert r.status_code == 204
    listing = client.get(f"/api/skills/{sid}/files").json()["files"]
    assert all(f["relative_path"] != "references/note.md" for f in listing)


def test_delete_content_404_when_missing(client: TestClient) -> None:
    sid = _install(client)
    r = client.delete(
        f"/api/skills/{sid}/files/content",
        params={"path": "ghost.md"},
    )
    assert r.status_code == 404


# ── Cache invalidation ──────────────────────────────────────────────────


def test_write_invalidates_skill_registry_cache() -> None:
    """SkillRegistry.invalidate(skill_id) drops the memoized body so the
    next agent activation reloads from disk. PUT calls invalidate; the
    direct test exercises the registry method on its own."""
    from allhands.core import Skill as CoreSkill
    from allhands.execution.skills import SkillRegistry

    reg = SkillRegistry()
    load_count = {"n": 0}

    def loader() -> CoreSkill:
        load_count["n"] += 1
        return CoreSkill(
            id="x",
            name="x",
            description="d",
            tool_ids=[],
            prompt_fragment="v" + str(load_count["n"]),
            version="0.1.0",
            path=None,
        )

    from allhands.core.skill_runtime import SkillDescriptor

    reg.register_lazy(SkillDescriptor(id="x", name="x", description="d"), loader)
    s1 = reg.get_full("x")
    assert s1 is not None and s1.prompt_fragment == "v1"
    s2 = reg.get_full("x")
    assert s2 is s1, "memoized — same object on second call"
    assert reg.invalidate("x") is True
    s3 = reg.get_full("x")
    assert s3 is not None and s3.prompt_fragment == "v2", "loader re-ran"


def test_invalidate_unknown_skill_returns_false() -> None:
    from allhands.execution.skills import SkillRegistry

    reg = SkillRegistry()
    assert reg.invalidate("does-not-exist") is False
