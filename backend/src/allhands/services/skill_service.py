"""SkillService — install / manage Skills from GitHub / market / local upload.

Mirrors what the `/skills` UI page exposes and what `execution/tools/meta/skill_tools.py`
advertises to Lead Agent. One service, two entry points.

Install sources:
- GitHub URL: arbitrary repo cloned via an injectable SkillSourceCloner (prod = git, tests = fake)
- Market slug: resolved against a `GithubSkillMarket` backend (prod = anthropics/skills, tests = fake)
- Local .zip: extract, validate SKILL.md, move into install_root/<slug>/

Each install writes a row to SkillRepo and returns the resulting Skill with
`installed_at` stamped and `path` pointing at the extracted directory.
"""

from __future__ import annotations

import asyncio
import io
import re
import shutil
import tarfile
import tempfile
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

import yaml

from allhands.core import Skill, SkillSource
from allhands.services.github_market import (
    GithubMarketEntry,
    GithubMarketError,
    GithubMarketPreview,
    GithubSkillMarket,
)

if TYPE_CHECKING:
    from allhands.persistence.repositories import SkillRepo


FRONTMATTER = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


class SkillInstallError(Exception):
    """Raised when skill install fails — missing SKILL.md / bad frontmatter / bad zip."""


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
        market: GithubSkillMarket,
        cloner: SkillSourceCloner | None = None,
    ) -> None:
        self._repo = repo
        self._install_root = install_root
        self._market = market
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

    async def list_market(self, query: str | None = None) -> list[GithubMarketEntry]:
        try:
            return await self._market.list(query)
        except GithubMarketError as exc:
            raise SkillInstallError(f"market list failed: {exc}") from exc

    async def preview_market_skill(self, slug: str) -> GithubMarketPreview:
        try:
            return await self._market.get_preview(slug)
        except GithubMarketError as exc:
            raise SkillInstallError(f"market preview failed: {exc}") from exc

    async def install_from_github(self, url: str, ref: str = "main") -> list[Skill]:
        """Clone a GitHub repo and install every discovered skill.

        Supports three repo layouts:
        1. Repo root has SKILL.md → install as single skill.
        2. Repo root has NO SKILL.md but subdirs (1-3 levels) each contain
           SKILL.md → install each as its own skill (e.g. anthropics/skills).
        3. Nothing found → raise SkillInstallError.

        Returns the list of installed skills (always ≥ 1 on success).
        """
        url_clean = url.rstrip("/")
        # Temporary clone destination; we move discovered skills to final
        # install_root/<slug>/ locations after scanning.
        with tempfile.TemporaryDirectory(prefix="allhands-gh-skill-") as tmp:
            tmp_root = Path(tmp) / "repo"
            await self._cloner.clone(url_clean, ref, tmp_root)
            skill_dirs = _discover_skill_dirs(tmp_root)
            if not skill_dirs:
                raise SkillInstallError(
                    "no SKILL.md found in cloned repo (searched root + top 3 levels of subdirs)"
                )
            self._install_root.mkdir(parents=True, exist_ok=True)
            installed: list[Skill] = []
            for skill_dir in skill_dirs:
                skill_md = skill_dir / "SKILL.md"
                fm = _parse_frontmatter(skill_md.read_text(encoding="utf-8"))
                slug = _slug_from_name(str(fm.get("name", skill_dir.name)))
                if not slug:
                    slug = _slug_from_name(skill_dir.name) or "skill"
                dest = self._install_root / slug
                if dest.exists():
                    shutil.rmtree(dest)
                shutil.move(str(skill_dir), str(dest))
                # Prefer a source_url that points at the specific subdir when
                # we installed from a multi-skill repo.
                if len(skill_dirs) == 1 and skill_dir == tmp_root:
                    source_url = url_clean
                else:
                    rel = skill_dir.relative_to(tmp_root).as_posix()
                    source_url = f"{url_clean}/tree/{ref}/{rel}" if rel else url_clean
                skill = _build_skill(
                    fm, source=SkillSource.GITHUB, source_url=source_url, path=dest
                )
                await self._repo.upsert(skill)
                installed.append(skill)
            return installed

    async def install_from_market(self, slug: str) -> Skill:
        try:
            tar_bytes, source_url = await self._market.fetch_archive(slug)
        except GithubMarketError as exc:
            raise SkillInstallError(str(exc)) from exc
        dest = self._install_root / slug
        if dest.exists():
            shutil.rmtree(dest)
        self._install_root.mkdir(parents=True, exist_ok=True)
        with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:gz") as tar:
            _safe_extract(tar, self._install_root)
        skill_md = dest / "SKILL.md"
        if not skill_md.exists():
            shutil.rmtree(dest, ignore_errors=True)
            raise SkillInstallError("SKILL.md missing in market archive")
        fm = _parse_frontmatter(skill_md.read_text(encoding="utf-8"))
        skill = _build_skill(fm, source=SkillSource.MARKET, source_url=source_url, path=dest)
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


def _safe_extract(tar: tarfile.TarFile, dest: Path) -> None:
    """Reject path-traversal members before extracting. Uses `filter='data'`
    per PEP 706 — strips setuid/device files and rejects absolute / traversing paths."""
    dest_abs = dest.resolve()
    for member in tar.getmembers():
        target = (dest / member.name).resolve()
        try:
            target.relative_to(dest_abs)
        except ValueError as exc:
            raise SkillInstallError(f"tar archive path traversal blocked: {member.name}") from exc
    tar.extractall(dest, filter="data")


def _find_skill_md(root: Path) -> Path | None:
    direct = root / "SKILL.md"
    if direct.exists():
        return direct
    for candidate in root.rglob("SKILL.md"):
        return candidate
    return None


_MAX_DISCOVER_DEPTH = 3


def _discover_skill_dirs(root: Path) -> list[Path]:
    """Return every directory that contains a SKILL.md at its root, searched
    up to ``_MAX_DISCOVER_DEPTH`` levels under ``root``.

    - If ``root/SKILL.md`` exists → return ``[root]`` (single-skill repo).
    - Else scan children; skip dot-dirs, ``node_modules``, ``.git``, ``tests``
      so that large scaffolding repos don't drown the agent in noise.
    - A directory nested *inside* another discovered skill (e.g. a skill's
      ``references/sub/SKILL.md``) is ignored — outer skill owns the tree.
    """
    if (root / "SKILL.md").exists():
        return [root]
    out: list[Path] = []
    skip = {".git", ".github", "node_modules", "__pycache__", "tests", "test", "dist", "build"}

    def visit(p: Path, depth: int) -> None:
        if depth > _MAX_DISCOVER_DEPTH:
            return
        try:
            children = sorted(p.iterdir())
        except OSError:
            return
        if (p / "SKILL.md").exists() and p != root:
            out.append(p)
            return  # don't descend into an already-discovered skill
        for child in children:
            if not child.is_dir():
                continue
            name = child.name
            if name.startswith(".") or name in skip:
                continue
            visit(child, depth + 1)

    visit(root, 0)
    return out
