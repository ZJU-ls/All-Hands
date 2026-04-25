"""EmployeeService · preset expansion at creation time.

Contract: docs/specs/agent-runtime-contract.md § 4.1-4.2.
CLAUDE.md §3.2: NO `mode` field. `preset` is a UI-side form template
expanded into (tool_ids, skill_ids, max_iterations) at the service layer.

Ref: ref-src-claude/V02-execution-kernel.md § 2.1 — employee identity is
carried entirely by its tool pool + system prompt + budget, not by a
type flag.
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlEmployeeRepo
from allhands.services.employee_service import EmployeeService


@pytest.fixture
async def svc():  # type: ignore[no-untyped-def]
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        yield EmployeeService(SqlEmployeeRepo(session))
    await engine.dispose()


async def test_preset_execute_defaults(svc) -> None:  # type: ignore[no-untyped-def]
    """preset='execute' · baseline tool set + max_iterations=10 (contract § 4.1)."""
    emp = await svc.create(
        name="Worker",
        description="d",
        system_prompt="p",
        model_ref="openai/gpt-4o-mini",
        preset="execute",
    )
    assert emp.max_iterations == 10
    assert "allhands.meta.resolve_skill" in emp.tool_ids


async def test_preset_plan_with_subagent_max_iterations_is_20(svc) -> None:  # type: ignore[no-untyped-def]
    """User feedback (2026-04-25): plan_with_subagent = 20 iter
    (was Q7's 15) for the orchestrator workflow's real footprint."""
    emp = await svc.create(
        name="Planner",
        description="d",
        system_prompt="p",
        model_ref="openai/gpt-4o-mini",
        preset="plan_with_subagent",
    )
    assert emp.max_iterations == 20


async def test_preset_custom_tool_ids_append_to_base(svc) -> None:  # type: ignore[no-untyped-def]
    """contract § 4.2 · custom tool_ids union with preset TOOL_IDS_BASE · dedupe."""
    emp = await svc.create(
        name="Worker",
        description="d",
        system_prompt="p",
        model_ref="openai/gpt-4o-mini",
        preset="execute",
        tool_ids=["allhands.builtin.fetch_url"],
    )
    assert "allhands.builtin.fetch_url" in emp.tool_ids
    assert "allhands.meta.resolve_skill" in emp.tool_ids


async def test_preset_custom_skill_ids_override_whitelist(svc) -> None:  # type: ignore[no-untyped-def]
    """Q6 signoff · user-supplied skill_ids fully replace the preset whitelist."""
    emp = await svc.create(
        name="Worker",
        description="d",
        system_prompt="p",
        model_ref="openai/gpt-4o-mini",
        preset="execute",
        skill_ids=["sk_research"],
    )
    assert emp.skill_ids == ["sk_research"]


async def test_preset_unknown_raises(svc) -> None:  # type: ignore[no-untyped-def]
    """Unknown preset id must fail loudly — prevents silent misconfig."""
    with pytest.raises(KeyError):
        await svc.create(
            name="X",
            description="d",
            system_prompt="p",
            model_ref="openai/gpt-4o-mini",
            preset="nonexistent",
        )
