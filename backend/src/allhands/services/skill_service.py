"""SkillService — install / manage Skills from github / market / local upload.

Mirrors what the `/skills` UI page exposes and what `execution/tools/meta/skill_tools.py`
advertises to Lead Agent. One service, two entry points.

Install sources:
- GitHub URL: cloned via an injectable SkillSourceCloner (prod uses git, tests fake it)
- Market slug: curated entries in `skills-market.json` resolve to a github URL
- Local .zip: extract, validate SKILL.md, move into install_root/<slug>/

Each install writes a row to SkillRepo and returns the resulting Skill with
`installed_at` stamped and `path` pointing at the extracted directory.
"""

from __future__ import annotations

import asyncio
import io
import json
import re
import shutil
import tempfile
import uuid
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

import yaml

from allhands.core import Skill, SkillSource

if TYPE_CHECKING:
    from allhands.persistence.repositories import SkillRepo


FRONTMATTER = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


class SkillInstallError(Exception):
    """Raised when skill install fails — missing SKILL.md / bad frontmatter / bad zip."""


@dataclass(frozen=True)
class MarketSkillEntry:
    slug: str
    name: str
    description: str
    source_url: str
    version: str


class SkillSourceCloner(Protocol):
    """Injectable clone backend — prod = git, tests = fake."""

    async def clone(self, url: str, ref: str, dest: Path) -> None: ...


class GitCloner:
    """Shells out to `git clone --depth=1 -b <ref> <url> <dest>`.

    Fails with SkillInstallError if git isn't on PATH or clone returns non-zero.
    """

    async def clone(self, url: str, ref: str, dest: Path) -> None:
        if shutil.which("git") is None:
            raise SkillInstallError("git executable not found on PATH")
        proc = await asyncio.create_subprocess_exec(
            "git",
            "clone",
            "--depth=1",
            "-b",
            ref,
            url,
            str(dest),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise SkillInstallError(f"git clone failed: {stderr.decode(errors='replace')}")


def _parse_frontmatter(text: str) -> dict[str, object]:
    m = FRONTMATTER.match(text)
    if not m:
        raise SkillInstallError("SKILL.md missing frontmatter block (--- ... ---)")
    data = yaml.safe_load(m.group(1)) or {}
    if not isinstance(data, dict):
        raise SkillInstallError("SKILL.md frontmatter must be a mapping")
    return data


def _slug_from_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _build_skill(
    frontmatter: dict[str, object],
    *,
    source: SkillSource,
    source_url: str | None,
    path: Path,
) -> Skill:
    try:
        name = str(frontmatter["name"])
        description = str(frontmatter.get("description", ""))
        version = str(frontmatter.get("version", "0.1.0"))
    except KeyError as exc:
        raise SkillInstallError(f"SKILL.md frontmatter missing field: {exc.args[0]}") from exc
    raw_tools = frontmatter.get("tool_ids", [])
    if not isinstance(raw_tools, list):
        raise SkillInstallError("SKILL.md frontmatter `tool_ids` must be a list")
    tool_ids = [str(t) for t in raw_tools]
    prompt_fragment = frontmatter.get("prompt_fragment")
    return Skill(
        id=str(uuid.uuid4()),
        name=name,
        description=description,
        tool_ids=tool_ids,
        prompt_fragment=str(prompt_fragment) if prompt_fragment else None,
        version=version,
        source=source,
        source_url=source_url,
        installed_at=datetime.now(UTC),
        path=str(path),
    )


class SkillService:
    def __init__(
        self,
        repo: SkillRepo,
        install_root: Path,
        market_file: Path,
        cloner: SkillSourceCloner | None = None,
    ) -> None:
        self._repo = repo
        self._install_root = install_root
        self._market_file = market_file
        self._cloner = cloner or GitCloner()

    async def list_all(self) -> list[Skill]:
        return await self._repo.list_all()

    async def get(self, skill_id: str) -> Skill | None:
        return await self._repo.get(skill_id)

    async def update(
        self,
        skill_id: str,
        *,
        description: str | None = None,
        prompt_fragment: str | None = None,
    ) -> Skill | None:
        current = await self._repo.get(skill_id)
        if current is None:
            return None
        update: dict[str, object] = {}
        if description is not None:
            update["description"] = description
        if prompt_fragment is not None:
            update["prompt_fragment"] = prompt_fragment
        if not update:
            return current
        new_skill = current.model_copy(update=update)
        await self._repo.upsert(new_skill)
        return new_skill

    async def delete(self, skill_id: str) -> None:
        current = await self._repo.get(skill_id)
        if current is None:
            return
        if current.path:
            shutil.rmtree(current.path, ignore_errors=True)
        await self._repo.delete(skill_id)

    async def list_market(self) -> list[MarketSkillEntry]:
        data = json.loads(self._market_file.read_text(encoding="utf-8"))
        return [
            MarketSkillEntry(
                slug=str(e["slug"]),
                name=str(e["name"]),
                description=str(e.get("description", "")),
                source_url=str(e["source_url"]),
                version=str(e.get("version", "0.1.0")),
            )
            for e in data.get("skills", [])
        ]

    async def install_from_github(self, url: str, ref: str = "main") -> Skill:
        slug = _slug_from_name(url.rstrip("/").split("/")[-1] or "skill")
        dest = self._install_root / slug
        if dest.exists():
            shutil.rmtree(dest)
        self._install_root.mkdir(parents=True, exist_ok=True)
        await self._cloner.clone(url, ref, dest)

        skill_md = dest / "SKILL.md"
        if not skill_md.exists():
            shutil.rmtree(dest, ignore_errors=True)
            raise SkillInstallError("SKILL.md missing in cloned repo root")
        fm = _parse_frontmatter(skill_md.read_text(encoding="utf-8"))
        skill = _build_skill(fm, source=SkillSource.GITHUB, source_url=url, path=dest)
        await self._repo.upsert(skill)
        return skill

    async def install_from_market(self, slug: str) -> Skill:
        entries = await self.list_market()
        entry = next((e for e in entries if e.slug == slug), None)
        if entry is None:
            raise SkillInstallError(f"market slug not found: {slug}")
        dest = self._install_root / entry.slug
        if dest.exists():
            shutil.rmtree(dest)
        self._install_root.mkdir(parents=True, exist_ok=True)
        await self._cloner.clone(entry.source_url, "main", dest)
        skill_md = dest / "SKILL.md"
        if not skill_md.exists():
            shutil.rmtree(dest, ignore_errors=True)
            raise SkillInstallError("SKILL.md missing in market-sourced repo")
        fm = _parse_frontmatter(skill_md.read_text(encoding="utf-8"))
        skill = _build_skill(fm, source=SkillSource.MARKET, source_url=entry.source_url, path=dest)
        await self._repo.upsert(skill)
        return skill

    async def install_from_upload(self, zip_bytes: bytes, filename: str) -> Skill:
        if not zip_bytes[:4].startswith(b"PK"):
            raise SkillInstallError("upload must be a .zip archive")
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            try:
                with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
                    zf.extractall(tmp_path)
            except zipfile.BadZipFile as exc:
                raise SkillInstallError(f"malformed zip: {exc}") from exc
            skill_md = _find_skill_md(tmp_path)
            if skill_md is None:
                raise SkillInstallError("SKILL.md not found inside uploaded zip")
            fm = _parse_frontmatter(skill_md.read_text(encoding="utf-8"))
            slug = _slug_from_name(str(fm.get("name", Path(filename).stem)))
            dest = self._install_root / slug
            if dest.exists():
                shutil.rmtree(dest)
            self._install_root.mkdir(parents=True, exist_ok=True)
            shutil.move(str(skill_md.parent), str(dest))
        skill = _build_skill(fm, source=SkillSource.LOCAL, source_url=filename, path=dest)
        await self._repo.upsert(skill)
        return skill


def _find_skill_md(root: Path) -> Path | None:
    direct = root / "SKILL.md"
    if direct.exists():
        return direct
    for candidate in root.rglob("SKILL.md"):
        return candidate
    return None
