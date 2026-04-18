"""GitHub-backed skill market.

Replaces the old hardcoded `skills-market.json` seed. The market is now a real
GitHub repository (default: `anthropics/skills`) listing skills under a subtree
(default: `skills/`). Each immediate child dir is one skill; its `SKILL.md`
frontmatter drives name/description/version.

Two entry points consume the same `GithubSkillMarket` protocol:
- `/api/skills/market` (REST, for the Skills UI page)
- `allhands.meta.list_skill_market` (Meta Tool, for Lead Agent via chat)

Mirrors L01 双入口 contract: one service impl, two entry points.

The real client (`AnthropicsSkillsMarket`) uses the public GitHub API for
listing and raw.githubusercontent.com for fetching `SKILL.md` previews. Install
downloads a tarball from `codeload.github.com` and extracts the single slug
subtree — avoids shelling out to `git`.

Tests use a `FakeGithubMarket` which returns canned entries + bytes.
"""

from __future__ import annotations

import asyncio
import re
import tarfile
import time
from dataclasses import dataclass, field
from io import BytesIO
from typing import Protocol

import httpx
import yaml

FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)

# Module-level alias so annotations inside the class don't collide with the
# `list` method name (mypy otherwise resolves `list` to the method).
_EntryList = list["GithubMarketEntry"]


class GithubMarketError(Exception):
    """Raised when the GitHub market backend fails (network / 404 / bad payload)."""


@dataclass(frozen=True)
class GithubMarketEntry:
    slug: str
    name: str
    description: str
    source_url: str
    version: str
    tags: tuple[str, ...] = ()


@dataclass(frozen=True)
class GithubMarketPreview:
    slug: str
    name: str
    description: str
    version: str
    source_url: str
    skill_md: str
    files: tuple[str, ...]


class GithubSkillMarket(Protocol):
    """Inject this protocol into `SkillService` for the market backend.

    Implementations:
    - `AnthropicsSkillsMarket` — live GitHub reads (prod)
    - `FakeGithubMarket` — tests
    """

    async def list(self, query: str | None = None) -> list[GithubMarketEntry]: ...
    async def get_preview(self, slug: str) -> GithubMarketPreview: ...
    async def fetch_archive(self, slug: str) -> tuple[bytes, str]:
        """Return (tarball_bytes, source_url). Tarball contains a single dir
        matching the skill slug at root (strip-1 layout)."""
        ...


def _parse_frontmatter(text: str) -> dict[str, object]:
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}
    data = yaml.safe_load(m.group(1)) or {}
    return data if isinstance(data, dict) else {}


def _matches_query(entry: GithubMarketEntry, query: str) -> bool:
    q = query.strip().lower()
    if not q:
        return True
    hay = " ".join([entry.slug, entry.name, entry.description, *entry.tags]).lower()
    return q in hay


@dataclass
class _CacheSlot:
    expires_at: float
    value: list[GithubMarketEntry]


@dataclass
class AnthropicsSkillsMarket:
    """GitHub-backed market client. Reads `anthropics/skills/skills/*` by default.

    Rate-limit-friendly: caches the full entry list in-memory for
    `cache_ttl_seconds`. An auth token lifts the anonymous 60 req/h cap.

    Not an `lru_cache` — we want instance-scoped caching so tests can isolate.
    """

    owner: str = "anthropics"
    repo: str = "skills"
    branch: str = "main"
    path_prefix: str = "skills"
    cache_ttl_seconds: int = 600
    token: str | None = None
    http: httpx.AsyncClient = field(default_factory=lambda: httpx.AsyncClient(timeout=20.0))

    _list_cache: _CacheSlot | None = field(default=None, init=False, repr=False)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock, init=False, repr=False)

    def _headers(self) -> dict[str, str]:
        h = {"Accept": "application/vnd.github+json", "User-Agent": "allhands-market/1.0"}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        return h

    def _source_url(self, slug: str) -> str:
        return (
            f"https://github.com/{self.owner}/{self.repo}/tree/"
            f"{self.branch}/{self.path_prefix}/{slug}"
        )

    def _raw_skill_md(self, slug: str) -> str:
        return (
            f"https://raw.githubusercontent.com/{self.owner}/{self.repo}/"
            f"{self.branch}/{self.path_prefix}/{slug}/SKILL.md"
        )

    async def list(self, query: str | None = None) -> list[GithubMarketEntry]:
        async with self._lock:
            now = time.monotonic()
            if self._list_cache is None or self._list_cache.expires_at < now:
                entries = await self._fetch_list_live()
                self._list_cache = _CacheSlot(
                    expires_at=now + self.cache_ttl_seconds, value=entries
                )
            entries = list(self._list_cache.value)
        if query:
            return [e for e in entries if _matches_query(e, query)]
        return entries

    async def _fetch_list_live(self) -> _EntryList:
        contents_url = (
            f"https://api.github.com/repos/{self.owner}/{self.repo}/contents/{self.path_prefix}"
            f"?ref={self.branch}"
        )
        try:
            resp = await self.http.get(contents_url, headers=self._headers())
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise GithubMarketError(f"list contents failed: {exc}") from exc
        payload = resp.json()
        if not isinstance(payload, list):
            raise GithubMarketError(f"unexpected GitHub response shape: {type(payload).__name__}")
        slugs = [item["name"] for item in payload if item.get("type") == "dir"]
        entries = await asyncio.gather(
            *(self._fetch_entry(slug) for slug in slugs),
            return_exceptions=True,
        )
        out: list[GithubMarketEntry] = []
        for result in entries:
            if isinstance(result, GithubMarketEntry):
                out.append(result)
        out.sort(key=lambda e: e.slug)
        return out

    async def _fetch_entry(self, slug: str) -> GithubMarketEntry:
        raw_url = self._raw_skill_md(slug)
        try:
            resp = await self.http.get(raw_url, headers=self._headers())
        except httpx.HTTPError as exc:
            raise GithubMarketError(f"fetch SKILL.md for {slug} failed: {exc}") from exc
        if resp.status_code == 404:
            raise GithubMarketError(f"{slug}/SKILL.md missing")
        resp.raise_for_status()
        fm = _parse_frontmatter(resp.text)
        name = str(fm.get("name", slug))
        description = str(fm.get("description", "")).strip()
        version = str(fm.get("version", "0.1.0"))
        raw_tags = fm.get("tags", [])
        tags: tuple[str, ...] = (
            tuple(str(t) for t in raw_tags) if isinstance(raw_tags, list) else ()
        )
        return GithubMarketEntry(
            slug=slug,
            name=name,
            description=description,
            source_url=self._source_url(slug),
            version=version,
            tags=tags,
        )

    async def get_preview(self, slug: str) -> GithubMarketPreview:
        raw_url = self._raw_skill_md(slug)
        try:
            resp = await self.http.get(raw_url, headers=self._headers())
        except httpx.HTTPError as exc:
            raise GithubMarketError(f"preview {slug} failed: {exc}") from exc
        if resp.status_code == 404:
            raise GithubMarketError(f"skill '{slug}' not found in market")
        resp.raise_for_status()
        text = resp.text
        fm = _parse_frontmatter(text)
        files = await self._list_files(slug)
        return GithubMarketPreview(
            slug=slug,
            name=str(fm.get("name", slug)),
            description=str(fm.get("description", "")).strip(),
            version=str(fm.get("version", "0.1.0")),
            source_url=self._source_url(slug),
            skill_md=text,
            files=files,
        )

    async def _list_files(self, slug: str) -> tuple[str, ...]:
        tree_url = (
            f"https://api.github.com/repos/{self.owner}/{self.repo}/git/trees/"
            f"{self.branch}?recursive=1"
        )
        try:
            resp = await self.http.get(tree_url, headers=self._headers())
        except httpx.HTTPError:
            return ()
        if resp.status_code != 200:
            return ()
        tree = resp.json().get("tree", [])
        prefix = f"{self.path_prefix}/{slug}/"
        files = [
            item["path"][len(prefix) :]
            for item in tree
            if item.get("type") == "blob"
            and isinstance(item.get("path"), str)
            and item["path"].startswith(prefix)
        ]
        return tuple(sorted(files))

    async def fetch_archive(self, slug: str) -> tuple[bytes, str]:
        archive_url = (
            f"https://codeload.github.com/{self.owner}/{self.repo}/tar.gz/refs/heads/{self.branch}"
        )
        try:
            resp = await self.http.get(archive_url, headers=self._headers(), timeout=60.0)
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise GithubMarketError(f"archive download failed: {exc}") from exc
        buf = BytesIO(resp.content)
        out = BytesIO()
        prefix_in_archive = f"{self.path_prefix}/{slug}/"
        found_any = False
        with (
            tarfile.open(fileobj=buf, mode="r:gz") as src,
            tarfile.open(fileobj=out, mode="w:gz") as dst,
        ):
            for member in src.getmembers():
                parts = member.name.split("/", 1)
                if len(parts) < 2:
                    continue
                relative = parts[1]
                if not relative.startswith(prefix_in_archive):
                    continue
                subpath = relative[len(prefix_in_archive) :]
                if not subpath:
                    continue
                found_any = True
                new_member = src.getmember(member.name)
                new_name = f"{slug}/{subpath}" if subpath != slug else slug
                new_member.name = new_name
                if member.isfile():
                    fileobj = src.extractfile(member)
                    dst.addfile(new_member, fileobj)
                else:
                    dst.addfile(new_member)
        if not found_any:
            raise GithubMarketError(f"slug '{slug}' not found in repo archive")
        return out.getvalue(), self._source_url(slug)

    async def aclose(self) -> None:
        await self.http.aclose()


@dataclass
class FakeGithubMarket:
    """In-memory market, for tests. Holds a dict of slug -> (SKILL.md text, files, tarball)."""

    entries: dict[str, tuple[str, tuple[str, ...], bytes]] = field(default_factory=dict)

    async def list(self, query: str | None = None) -> list[GithubMarketEntry]:
        out: list[GithubMarketEntry] = []
        for slug, (skill_md, _files, _tar) in self.entries.items():
            fm = _parse_frontmatter(skill_md)
            raw_tags = fm.get("tags", [])
            tags: tuple[str, ...] = (
                tuple(str(t) for t in raw_tags) if isinstance(raw_tags, list) else ()
            )
            entry = GithubMarketEntry(
                slug=slug,
                name=str(fm.get("name", slug)),
                description=str(fm.get("description", "")).strip(),
                source_url=f"https://github.com/fake/repo/tree/main/skills/{slug}",
                version=str(fm.get("version", "0.1.0")),
                tags=tags,
            )
            out.append(entry)
        out.sort(key=lambda e: e.slug)
        if query:
            return [e for e in out if _matches_query(e, query)]
        return out

    async def get_preview(self, slug: str) -> GithubMarketPreview:
        entry = self.entries.get(slug)
        if entry is None:
            raise GithubMarketError(f"skill '{slug}' not found in market")
        skill_md, files, _tar = entry
        fm = _parse_frontmatter(skill_md)
        return GithubMarketPreview(
            slug=slug,
            name=str(fm.get("name", slug)),
            description=str(fm.get("description", "")).strip(),
            version=str(fm.get("version", "0.1.0")),
            source_url=f"https://github.com/fake/repo/tree/main/skills/{slug}",
            skill_md=skill_md,
            files=files,
        )

    async def fetch_archive(self, slug: str) -> tuple[bytes, str]:
        entry = self.entries.get(slug)
        if entry is None:
            raise GithubMarketError(f"skill '{slug}' not found in market")
        _skill_md, _files, tar = entry
        return tar, f"https://github.com/fake/repo/tree/main/skills/{slug}"
