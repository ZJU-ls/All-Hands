"""SkillService.list_all 合并 repo + registry 路径

回归 2026-04-25 修复:`/skills` 页面「平台内建 KPI」永远 0 的根因是
SkillService.list_all 仅读 SqlSkillRepo · 不看 in-memory SkillRegistry。

这里覆盖 4 种组合:
1. 只 repo  (legacy / 测试夹具) — registry=None,只返回安装的
2. 只 registry — repo 空 · registry 有 builtin
3. repo + registry,无重叠 — 全集
4. repo + registry,有重叠(同 id) — DB 行覆盖 builtin descriptor
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from allhands.core import Skill, SkillSource
from allhands.execution.skills import SkillRegistry
from allhands.services.skill_service import SkillService


class _FakeRepo:
    """In-memory SkillRepo stub. Only list_all + get used by these tests."""

    def __init__(self, skills: list[Skill]) -> None:
        self._items = list(skills)

    async def list_all(self) -> list[Skill]:
        return list(self._items)

    async def get(self, skill_id: str) -> Skill | None:
        return next((s for s in self._items if s.id == skill_id), None)


def _make_skill(sid: str, source: SkillSource = SkillSource.MARKET) -> Skill:
    return Skill(
        id=sid,
        name=sid,
        description="",
        tool_ids=[],
        prompt_fragment=None,
        version="1.0.0",
        source=source,
        source_url=None,
        installed_at=datetime.now(UTC),
        path=None,
    )


def _make_registry_with(builtin_ids: list[str]) -> SkillRegistry:
    reg = SkillRegistry()
    for sid in builtin_ids:
        reg.register(_make_skill(sid, source=SkillSource.BUILTIN))
    return reg


def _service_for(repo_skills: list[Skill], registry: SkillRegistry | None) -> SkillService:
    return SkillService(
        repo=_FakeRepo(repo_skills),  # type: ignore[arg-type]
        install_root=Path("/tmp/test-skills"),  # not used in list_all path
        market=None,  # type: ignore[arg-type]
        registry=registry,
    )


@pytest.mark.asyncio
async def test_list_all_repo_only_when_registry_none() -> None:
    """legacy 行为:registry=None 时只返回 DB 行。"""
    svc = _service_for([_make_skill("a"), _make_skill("b")], registry=None)
    out = await svc.list_all()
    assert {s.id for s in out} == {"a", "b"}


@pytest.mark.asyncio
async def test_list_all_registry_only_when_repo_empty() -> None:
    """空 DB · 全部从 registry 出来。"""
    reg = _make_registry_with(["allhands.team_management", "allhands.market_data"])
    svc = _service_for([], registry=reg)
    out = await svc.list_all()
    assert {s.id for s in out} == {
        "allhands.team_management",
        "allhands.market_data",
    }


@pytest.mark.asyncio
async def test_list_all_unions_disjoint_sets() -> None:
    """无重叠 · 全集返回 · DB 行 + builtin 都在。"""
    repo_skills = [_make_skill("market.foo"), _make_skill("market.bar")]
    reg = _make_registry_with(["allhands.team_management", "allhands.observatory"])
    svc = _service_for(repo_skills, registry=reg)
    out = await svc.list_all()
    assert len(out) == 4
    assert {s.id for s in out} == {
        "market.foo",
        "market.bar",
        "allhands.team_management",
        "allhands.observatory",
    }


@pytest.mark.asyncio
async def test_list_all_db_row_wins_on_collision() -> None:
    """DB 与 registry 同 id · DB 行优先(用户安装/定制的 builtin 影子覆盖)。

    例:用户 fork 了一个 allhands.team_management 自己改了点 · 装到 market 后
    DB 有同 id 的 row · 应该用 DB 的版本不是 builtin 的。
    """
    customized = _make_skill("allhands.team_management", source=SkillSource.MARKET)
    reg = _make_registry_with(["allhands.team_management", "allhands.observatory"])
    svc = _service_for([customized], registry=reg)
    out = await svc.list_all()
    by_id = {s.id: s for s in out}
    assert len(out) == 2
    assert by_id["allhands.team_management"].source == SkillSource.MARKET
    assert by_id["allhands.observatory"].source == SkillSource.BUILTIN


@pytest.mark.asyncio
async def test_get_falls_back_to_registry_when_db_misses() -> None:
    """`get()` 也加了 fallback · 单条查找时同样规则。"""
    reg = _make_registry_with(["allhands.observatory"])
    svc = _service_for([], registry=reg)
    out = await svc.get("allhands.observatory")
    assert out is not None
    assert out.id == "allhands.observatory"


@pytest.mark.asyncio
async def test_get_db_wins_over_registry() -> None:
    customized = _make_skill("allhands.observatory", source=SkillSource.MARKET)
    reg = _make_registry_with(["allhands.observatory"])
    svc = _service_for([customized], registry=reg)
    out = await svc.get("allhands.observatory")
    assert out is not None
    assert out.source == SkillSource.MARKET


@pytest.mark.asyncio
async def test_get_returns_none_when_neither_has_it() -> None:
    reg = _make_registry_with(["allhands.observatory"])
    svc = _service_for([], registry=reg)
    out = await svc.get("nonexistent.skill")
    assert out is None
