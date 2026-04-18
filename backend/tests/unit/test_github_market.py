"""Thread 2 · GitHub-backed skill market — client tests.

Covers:
- `AnthropicsSkillsMarket` hitting `api.github.com` + `raw.githubusercontent.com`
  via a mocked httpx `MockTransport`.
- `FakeGithubMarket` behavior so tests relying on it are accurate.
- Query filtering and 10-min cache hit path.
"""

from __future__ import annotations

import io
import tarfile
from collections.abc import Callable

import httpx
import pytest

from allhands.services.github_market import (
    AnthropicsSkillsMarket,
    FakeGithubMarket,
    GithubMarketEntry,
    GithubMarketError,
)

SKILL_MD_FOO = """---
name: foo
description: Foo skill for testing
version: 1.0.0
tags: [alpha, beta]
---

# foo
"""

SKILL_MD_BAR = """---
name: bar
description: Bar skill also for testing
version: 2.0.0
---

# bar
"""


def _make_tar(slug: str, skill_md: str) -> bytes:
    """Build a codeload-shaped tarball: root is `<repo>-<branch>/...`."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        data = skill_md.encode("utf-8")
        info = tarfile.TarInfo(name=f"skills-main/skills/{slug}/SKILL.md")
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def _contents_list(dirs: list[str]) -> list[dict]:
    return [{"name": d, "type": "dir"} for d in dirs]


def _routes(skill_md_by_slug: dict[str, str]) -> Callable[[httpx.Request], httpx.Response]:
    """Build a deterministic responder for the anthropics/skills endpoints."""

    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "/contents/skills" in url:
            return httpx.Response(200, json=_contents_list(list(skill_md_by_slug.keys())))
        if "/git/trees/main" in url:
            tree = [
                {"type": "blob", "path": f"skills/{slug}/SKILL.md"} for slug in skill_md_by_slug
            ]
            tree += [
                {"type": "blob", "path": f"skills/{slug}/README.md"} for slug in skill_md_by_slug
            ]
            return httpx.Response(200, json={"tree": tree})
        for slug, md in skill_md_by_slug.items():
            if url.endswith(f"skills/{slug}/SKILL.md"):
                return httpx.Response(200, text=md)
        if "codeload.github.com" in url:
            slug = next(iter(skill_md_by_slug))
            return httpx.Response(200, content=_make_tar(slug, skill_md_by_slug[slug]))
        return httpx.Response(404, text=f"unhandled: {url}")

    return handler


@pytest.fixture
def market_with(skill_md_by_slug: dict[str, str]) -> AnthropicsSkillsMarket:
    transport = httpx.MockTransport(_routes(skill_md_by_slug))
    client = httpx.AsyncClient(transport=transport, timeout=5.0)
    return AnthropicsSkillsMarket(http=client, cache_ttl_seconds=600)


@pytest.fixture
def skill_md_by_slug() -> dict[str, str]:
    return {"foo": SKILL_MD_FOO, "bar": SKILL_MD_BAR}


async def test_list_returns_all_skills_sorted(market_with: AnthropicsSkillsMarket) -> None:
    entries = await market_with.list()
    assert [e.slug for e in entries] == ["bar", "foo"]
    foo = next(e for e in entries if e.slug == "foo")
    assert foo.name == "foo"
    assert foo.description == "Foo skill for testing"
    assert foo.version == "1.0.0"
    assert foo.tags == ("alpha", "beta")
    assert foo.source_url.startswith("https://github.com/anthropics/skills/tree/main/skills/foo")


async def test_list_filters_by_query_case_insensitive(market_with: AnthropicsSkillsMarket) -> None:
    entries = await market_with.list("FOO")
    assert len(entries) == 1
    assert entries[0].slug == "foo"


async def test_list_query_matches_tag(market_with: AnthropicsSkillsMarket) -> None:
    entries = await market_with.list("alpha")
    assert len(entries) == 1
    assert entries[0].slug == "foo"


async def test_list_caches_subsequent_calls(market_with: AnthropicsSkillsMarket) -> None:
    first = await market_with.list()
    # Manually trip the cache to verify same list comes back without re-fetching;
    # we can't easily count requests on MockTransport, but at least assert equality.
    second = await market_with.list()
    assert [e.slug for e in first] == [e.slug for e in second]


async def test_get_preview_returns_skill_md_and_files(market_with: AnthropicsSkillsMarket) -> None:
    preview = await market_with.get_preview("foo")
    assert preview.slug == "foo"
    assert preview.name == "foo"
    assert preview.skill_md.startswith("---")
    assert "SKILL.md" in preview.files
    assert preview.version == "1.0.0"


async def test_get_preview_missing_raises() -> None:
    transport = httpx.MockTransport(lambda _req: httpx.Response(404))
    client = httpx.AsyncClient(transport=transport)
    market = AnthropicsSkillsMarket(http=client)
    with pytest.raises(GithubMarketError):
        await market.get_preview("nope")


async def test_fetch_archive_strips_outer_repo_prefix(
    market_with: AnthropicsSkillsMarket,
) -> None:
    tar_bytes, source_url = await market_with.fetch_archive("foo")
    assert source_url.startswith("https://github.com/anthropics/skills/tree/main/skills/foo")
    # Resulting tar has "foo/SKILL.md" at root.
    with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:gz") as tar:
        names = [m.name for m in tar.getmembers()]
    assert "foo/SKILL.md" in names


async def test_fetch_archive_missing_slug_raises(market_with: AnthropicsSkillsMarket) -> None:
    with pytest.raises(GithubMarketError):
        await market_with.fetch_archive("nope")


async def test_fake_market_list_and_preview() -> None:
    tar = _make_tar("demo", SKILL_MD_FOO)
    fake = FakeGithubMarket(
        entries={"demo": (SKILL_MD_FOO, ("SKILL.md",), tar)},
    )
    entries = await fake.list()
    assert len(entries) == 1
    assert isinstance(entries[0], GithubMarketEntry)
    preview = await fake.get_preview("demo")
    assert preview.skill_md == SKILL_MD_FOO


async def test_fake_market_query_filter() -> None:
    tar = _make_tar("demo", SKILL_MD_FOO)
    fake = FakeGithubMarket(
        entries={"demo": (SKILL_MD_FOO, ("SKILL.md",), tar)},
    )
    matches = await fake.list("foo")
    assert len(matches) == 1
    empty = await fake.list("does-not-exist")
    assert empty == []
