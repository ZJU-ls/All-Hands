"""Task 2 · SkillService unit tests.

Uses a fake SkillRepo + fake cloner + fake GithubSkillMarket — tests never touch
the network. Covers install_from_github / install_from_market / install_from_upload /
update / delete / list_market / preview_market_skill.
"""

from __future__ import annotations

import io
import tarfile
import zipfile
from pathlib import Path
from typing import ClassVar

import pytest

from allhands.core import Skill, SkillSource
from allhands.services.github_market import FakeGithubMarket
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


def _make_tar(slug: str, skill_md: str, extra_files: dict[str, str] | None = None) -> bytes:
    """Build a tarball with `<slug>/SKILL.md` (+ optional extras) at root."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        data = skill_md.encode("utf-8")
        info = tarfile.TarInfo(name=f"{slug}/SKILL.md")
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
        for name, content in (extra_files or {}).items():
            body = content.encode("utf-8")
            info = tarfile.TarInfo(name=f"{slug}/{name}")
            info.size = len(body)
            tar.addfile(info, io.BytesIO(body))
    return buf.getvalue()


@pytest.fixture
def install_root(tmp_path: Path) -> Path:
    return tmp_path / "skills"


@pytest.fixture
def repo() -> FakeSkillRepo:
    return FakeSkillRepo()


@pytest.fixture
def market() -> FakeGithubMarket:
    tar = _make_tar("test-skill", SKILL_MD, {"README.md": "hello"})
    return FakeGithubMarket(entries={"test-skill": (SKILL_MD, ("SKILL.md", "README.md"), tar)})


@pytest.fixture
def service(repo: FakeSkillRepo, install_root: Path, market: FakeGithubMarket) -> SkillService:
    FakeCloner.clone_calls.clear()
    return SkillService(
        repo=repo,
        install_root=install_root,
        market=market,
        cloner=FakeCloner(),
    )


async def test_install_from_github_registers_skill(
    service: SkillService, repo: FakeSkillRepo
) -> None:
    skills = await service.install_from_github("https://github.com/example/test-skill", ref="main")
    assert len(skills) == 1
    skill = skills[0]
    assert skill.name == "test-skill"
    assert skill.source == SkillSource.GITHUB
    assert skill.source_url == "https://github.com/example/test-skill"
    assert skill.version == "0.2.0"
    assert skill.installed_at is not None
    assert skill.path is not None
    assert (Path(skill.path) / "SKILL.md").exists()
    assert await repo.get(skill.id) is not None


async def test_install_from_market_uses_github_archive(
    service: SkillService, install_root: Path
) -> None:
    skill = await service.install_from_market("test-skill")
    assert skill.source == SkillSource.MARKET
    assert skill.source_url.startswith("https://github.com/fake/repo/tree/main/skills/test-skill")
    assert skill.path is not None
    assert (Path(skill.path) / "SKILL.md").exists()
    assert (Path(skill.path) / "README.md").exists()


async def test_install_from_market_unknown_slug_raises(service: SkillService) -> None:
    with pytest.raises(SkillInstallError):
        await service.install_from_market("nope")


async def test_install_from_github_multi_skill_repo_installs_all(
    repo: FakeSkillRepo, install_root: Path, market: FakeGithubMarket
) -> None:
    """Repo layout like anthropics/skills: no root SKILL.md, multiple under
    `skills/<name>/SKILL.md`. All should install, each with its own slug."""

    def _md(name: str) -> str:
        return (
            "---\n"
            f"name: {name}\n"
            f"description: {name} skill\n"
            "version: 1.0.0\n"
            "tool_ids: []\n"
            "---\n\nbody\n"
        )

    class MultiCloner:
        async def clone(self, url: str, ref: str, dest: Path) -> None:
            dest.mkdir(parents=True, exist_ok=True)
            for slug in ("alpha", "beta", "gamma"):
                sd = dest / "skills" / slug
                sd.mkdir(parents=True)
                (sd / "SKILL.md").write_text(_md(slug), encoding="utf-8")

    svc = SkillService(repo=repo, install_root=install_root, market=market, cloner=MultiCloner())
    installed = await svc.install_from_github("https://github.com/anthropics/skills", ref="main")
    assert {s.name for s in installed} == {"alpha", "beta", "gamma"}
    for s in installed:
        assert s.source == SkillSource.GITHUB
        assert s.source_url.endswith(f"/tree/main/skills/{s.name}")
        assert s.path is not None
        assert (Path(s.path) / "SKILL.md").exists()
    # all persisted separately
    assert len(await repo.list_all()) == 3


async def test_install_from_github_skips_dot_and_noise_dirs(
    repo: FakeSkillRepo, install_root: Path, market: FakeGithubMarket
) -> None:
    class NoisyCloner:
        async def clone(self, url: str, ref: str, dest: Path) -> None:
            dest.mkdir(parents=True, exist_ok=True)
            # real skill
            sd = dest / "skills" / "real"
            sd.mkdir(parents=True)
            (sd / "SKILL.md").write_text(
                "---\nname: real\ndescription: r\nversion: 1.0.0\ntool_ids: []\n---\nbody\n",
                encoding="utf-8",
            )
            # noise — must be skipped
            for noise in (".git", "node_modules", "tests"):
                nd = dest / noise / "accidental"
                nd.mkdir(parents=True)
                (nd / "SKILL.md").write_text(
                    "---\nname: accidental\ndescription: x\nversion: 1.0.0\ntool_ids: []\n---\n",
                    encoding="utf-8",
                )

    svc = SkillService(repo=repo, install_root=install_root, market=market, cloner=NoisyCloner())
    installed = await svc.install_from_github("https://github.com/x/y")
    assert [s.name for s in installed] == ["real"]


async def test_install_from_github_missing_skill_md_raises(
    repo: FakeSkillRepo, install_root: Path, market: FakeGithubMarket
) -> None:
    class EmptyCloner:
        async def clone(self, url: str, ref: str, dest: Path) -> None:
            dest.mkdir(parents=True, exist_ok=True)
            # no SKILL.md

    svc = SkillService(repo=repo, install_root=install_root, market=market, cloner=EmptyCloner())
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


async def test_list_market_filters_by_query(service: SkillService) -> None:
    # query matching the description "A test skill"
    matches = await service.list_market("test skill")
    assert len(matches) == 1
    # non-matching query
    none = await service.list_market("nonexistent-term-xyz")
    assert none == []


async def test_preview_market_skill_returns_skill_md(service: SkillService) -> None:
    preview = await service.preview_market_skill("test-skill")
    assert preview.slug == "test-skill"
    assert "test-skill" in preview.skill_md
    assert "SKILL.md" in preview.files


async def test_preview_market_skill_unknown_raises(service: SkillService) -> None:
    with pytest.raises(SkillInstallError):
        await service.preview_market_skill("nope")


async def test_delete_removes_db_and_disk(
    service: SkillService, repo: FakeSkillRepo, install_root: Path
) -> None:
    skills = await service.install_from_github("https://github.com/example/test-skill")
    skill = skills[0]
    assert skill.path is not None
    skill_path = Path(skill.path)
    assert skill_path.exists()

    await service.delete(skill.id)

    assert await repo.get(skill.id) is None
    assert not skill_path.exists()


async def test_update_only_description_and_prompt(
    service: SkillService, repo: FakeSkillRepo
) -> None:
    skills = await service.install_from_github("https://github.com/example/test-skill")
    skill = skills[0]
    updated = await service.update(skill.id, description="new desc", prompt_fragment="new prompt")
    assert updated is not None
    assert updated.description == "new desc"
    assert updated.prompt_fragment == "new prompt"
    assert updated.name == skill.name  # immutable via this path
