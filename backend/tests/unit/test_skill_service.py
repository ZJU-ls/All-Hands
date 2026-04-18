"""Task 2 · SkillService unit tests.

Uses a fake SkillRepo + fake cloner so tests don't touch the network or git.
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path
from typing import ClassVar

import pytest

from allhands.core import Skill, SkillSource
from allhands.services.skill_service import (
    SkillInstallError,
    SkillService,
    SkillSourceCloner,
)


class FakeSkillRepo:
    def __init__(self) -> None:
        self._by_id: dict[str, Skill] = {}

    async def get(self, skill_id: str) -> Skill | None:
        return self._by_id.get(skill_id)

    async def list_all(self) -> list[Skill]:
        return list(self._by_id.values())

    async def upsert(self, skill: Skill) -> None:
        self._by_id[skill.id] = skill

    async def delete(self, skill_id: str) -> None:
        self._by_id.pop(skill_id, None)


SKILL_MD = """---
name: test-skill
description: A test skill
version: 0.2.0
tool_ids: []
---

# test-skill

A tiny skill body.
"""


class FakeCloner(SkillSourceCloner):
    """Writes a canned SKILL.md into the target dir — mimics `git clone`."""

    clone_calls: ClassVar[list[tuple[str, str, str]]] = []

    async def clone(self, url: str, ref: str, dest: Path) -> None:
        FakeCloner.clone_calls.append((url, ref, str(dest)))
        dest.mkdir(parents=True, exist_ok=True)
        (dest / "SKILL.md").write_text(SKILL_MD, encoding="utf-8")


@pytest.fixture
def install_root(tmp_path: Path) -> Path:
    return tmp_path / "skills"


@pytest.fixture
def repo() -> FakeSkillRepo:
    return FakeSkillRepo()


@pytest.fixture
def market_file(tmp_path: Path) -> Path:
    market = tmp_path / "skills-market.json"
    market.write_text(
        """{
          "version": 1,
          "skills": [
            {
              "slug": "test-skill",
              "name": "test-skill",
              "description": "fixture skill",
              "source_url": "https://github.com/example/test-skill",
              "version": "0.2.0"
            }
          ]
        }""",
        encoding="utf-8",
    )
    return market


@pytest.fixture
def service(repo: FakeSkillRepo, install_root: Path, market_file: Path) -> SkillService:
    FakeCloner.clone_calls.clear()
    return SkillService(
        repo=repo,
        install_root=install_root,
        market_file=market_file,
        cloner=FakeCloner(),
    )


async def test_install_from_github_registers_skill(
    service: SkillService, repo: FakeSkillRepo
) -> None:
    skill = await service.install_from_github("https://github.com/example/test-skill", ref="main")
    assert skill.name == "test-skill"
    assert skill.source == SkillSource.GITHUB
    assert skill.source_url == "https://github.com/example/test-skill"
    assert skill.version == "0.2.0"
    assert skill.installed_at is not None
    assert skill.path is not None
    assert (Path(skill.path) / "SKILL.md").exists()
    assert await repo.get(skill.id) is not None


async def test_install_from_market_uses_slug_entry(service: SkillService) -> None:
    skill = await service.install_from_market("test-skill")
    assert skill.source == SkillSource.MARKET
    assert skill.source_url == "https://github.com/example/test-skill"
    assert FakeCloner.clone_calls[-1][0] == "https://github.com/example/test-skill"


async def test_install_from_market_unknown_slug_raises(service: SkillService) -> None:
    with pytest.raises(SkillInstallError):
        await service.install_from_market("nope")


async def test_install_from_github_missing_skill_md_raises(
    repo: FakeSkillRepo, install_root: Path, market_file: Path
) -> None:
    class EmptyCloner:
        async def clone(self, url: str, ref: str, dest: Path) -> None:
            dest.mkdir(parents=True, exist_ok=True)
            # no SKILL.md

    svc = SkillService(
        repo=repo, install_root=install_root, market_file=market_file, cloner=EmptyCloner()
    )
    with pytest.raises(SkillInstallError, match=r"SKILL\.md"):
        await svc.install_from_github("https://github.com/example/nope")


async def test_install_from_upload_unpacks_zip(service: SkillService, repo: FakeSkillRepo) -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("SKILL.md", SKILL_MD)
    skill = await service.install_from_upload(buf.getvalue(), filename="test.zip")
    assert skill.source == SkillSource.LOCAL
    assert skill.name == "test-skill"
    assert await repo.get(skill.id) is not None


async def test_install_from_upload_rejects_non_zip(service: SkillService) -> None:
    with pytest.raises(SkillInstallError, match="zip"):
        await service.install_from_upload(b"not a zip", filename="foo.txt")


async def test_list_market_returns_seeds(service: SkillService) -> None:
    entries = await service.list_market()
    assert any(e.slug == "test-skill" for e in entries)


async def test_delete_removes_db_and_disk(
    service: SkillService, repo: FakeSkillRepo, install_root: Path
) -> None:
    skill = await service.install_from_github("https://github.com/example/test-skill")
    assert skill.path is not None
    skill_path = Path(skill.path)
    assert skill_path.exists()

    await service.delete(skill.id)

    assert await repo.get(skill.id) is None
    assert not skill_path.exists()


async def test_update_only_description_and_prompt(
    service: SkillService, repo: FakeSkillRepo
) -> None:
    skill = await service.install_from_github("https://github.com/example/test-skill")
    updated = await service.update(skill.id, description="new desc", prompt_fragment="new prompt")
    assert updated is not None
    assert updated.description == "new desc"
    assert updated.prompt_fragment == "new prompt"
    assert updated.name == skill.name  # immutable via this path
