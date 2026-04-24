"""End-to-end tests for /api/skills — router + service + repo chain.

Uses an in-memory SQLite session and a FakeCloner + FakeGithubMarket override on
SkillService so tests don't hit the network. Covers legacy behavior plus new
search + preview endpoints.
"""

from __future__ import annotations

import io
import tarfile
import zipfile
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
name: fixture-skill
description: fixture skill description
version: 0.1.0
tool_ids: []
tags: [demo, fixture]
---
body
"""


class FakeCloner:
    async def clone(self, url: str, ref: str, dest: Path) -> None:
        dest.mkdir(parents=True, exist_ok=True)
        (dest / "SKILL.md").write_text(SKILL_MD, encoding="utf-8")


def _fake_market_tar(slug: str, skill_md: str) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        data = skill_md.encode("utf-8")
        info = tarfile.TarInfo(name=f"{slug}/SKILL.md")
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    async def _session() -> AsyncIterator[AsyncSession]:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as s, s.begin():
            yield s

    tar = _fake_market_tar("fixture-skill", SKILL_MD)
    fake_market = FakeGithubMarket(
        entries={"fixture-skill": (SKILL_MD, ("SKILL.md",), tar)},
    )

    async def _skill_service(session: AsyncSession = Depends(_session)) -> SkillService:
        return SkillService(
            repo=SqlSkillRepo(session),
            install_root=data_dir / "skills",
            market=fake_market,
            cloner=FakeCloner(),
        )

    app = create_app()
    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_skill_service] = _skill_service
    return TestClient(app)


def test_list_empty(client: TestClient) -> None:
    response = client.get("/api/skills")
    assert response.status_code == 200
    assert response.json() == []


def test_list_market_returns_seed(client: TestClient) -> None:
    response = client.get("/api/skills/market")
    assert response.status_code == 200
    data = response.json()
    assert any(s["slug"] == "fixture-skill" for s in data)
    fixture = next(s for s in data if s["slug"] == "fixture-skill")
    assert fixture["tags"] == ["demo", "fixture"]


def test_list_market_filters_by_query(client: TestClient) -> None:
    r = client.get("/api/skills/market", params={"q": "fixture"})
    assert r.status_code == 200
    assert len(r.json()) == 1
    r2 = client.get("/api/skills/market", params={"q": "does-not-exist"})
    assert r2.status_code == 200
    assert r2.json() == []


def test_market_preview_returns_skill_md(client: TestClient) -> None:
    r = client.get("/api/skills/market/fixture-skill/preview")
    assert r.status_code == 200
    body = r.json()
    assert body["slug"] == "fixture-skill"
    assert body["skill_md"].startswith("---")
    assert "SKILL.md" in body["files"]


def test_market_preview_unknown_slug_404(client: TestClient) -> None:
    r = client.get("/api/skills/market/nope/preview")
    assert r.status_code == 404


def test_install_from_market_then_list(client: TestClient) -> None:
    r1 = client.post("/api/skills/install/market", json={"slug": "fixture-skill"})
    assert r1.status_code == 201
    body = r1.json()
    assert body["name"] == "fixture-skill"
    assert body["source"] == "market"
    assert body["installed_at"] is not None

    r2 = client.get("/api/skills")
    assert r2.status_code == 200
    assert len(r2.json()) == 1


def test_install_from_github_then_patch_then_delete(client: TestClient) -> None:
    r1 = client.post(
        "/api/skills/install/github",
        json={"url": "https://github.com/example/foo", "ref": "main"},
    )
    assert r1.status_code == 201
    body = r1.json()
    assert body["count"] == 1
    skill = body["skills"][0]
    sid = skill["id"]

    r2 = client.patch(f"/api/skills/{sid}", json={"description": "updated"})
    assert r2.status_code == 200
    assert r2.json()["description"] == "updated"

    r3 = client.delete(f"/api/skills/{sid}")
    assert r3.status_code == 204

    r4 = client.get(f"/api/skills/{sid}")
    assert r4.status_code == 404


def test_install_market_unknown_slug_returns_400(client: TestClient) -> None:
    r = client.post("/api/skills/install/market", json={"slug": "nope"})
    assert r.status_code == 400


def test_install_from_upload_zip(client: TestClient) -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("SKILL.md", SKILL_MD)
    files = {"file": ("test.zip", buf.getvalue(), "application/zip")}
    r = client.post("/api/skills/install/upload", files=files)
    assert r.status_code == 201
    assert r.json()["source"] == "local"
