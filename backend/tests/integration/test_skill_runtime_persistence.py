"""Regression: SkillRuntime survives a cache wipe (process restart simulation).

ADR 0011 · principle 7 · state-checkpointable clause:

  "所有影响后续决策的 runtime 状态必须可 checkpoint 到 L3(进程重启可 resume)。"

Before this change, `ChatService._runtime_cache` was the only store for
which skills Lead Agent had activated this conversation. A `uvicorn --reload`
wiped it and the next user message saw an empty capability pool, so the Lead
had to re-`resolve_skill` from scratch (and often forgot to, see L06).

These tests pin the three invariants of the fix:

  1. `SqlSkillRuntimeRepo` round-trips `SkillRuntime` across sessions.
  2. `ChatService` cache miss falls through to the repo and restores the
     previously flushed runtime (simulates process restart).
  3. `compact_conversation` clears BOTH the in-memory cache and the repo row
     (the resolved-skill set was built against a history the user no longer
     sees, so it must not survive the compact either).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from allhands.core import Conversation, Employee, SkillDescriptor, SkillRuntime
from allhands.execution.gate import AutoApproveGate
from allhands.execution.registry import ToolRegistry
from allhands.execution.skills import SkillRegistry
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import (
    SqlConversationRepo,
    SqlEmployeeRepo,
    SqlSkillRuntimeRepo,
)
from allhands.services.chat_service import ChatService


def _make_emp() -> Employee:
    return Employee(
        id="emp1",
        name="persist-test",
        description="",
        system_prompt="test-employee",
        model_ref="default",
        tool_ids=[],
        skill_ids=[],
        max_iterations=10,
        is_lead_agent=False,
        created_by="system",
        created_at=datetime.now(UTC),
        metadata={},
    )


def _make_conv() -> Conversation:
    return Conversation(
        id="conv1",
        employee_id="emp1",
        title=None,
        created_at=datetime(2026, 4, 21, tzinfo=UTC),
        metadata={},
    )


def _activated_runtime() -> SkillRuntime:
    """Shape of a runtime where Lead has resolved one skill."""
    return SkillRuntime(
        base_tool_ids=["allhands.builtin.fetch_url"],
        skill_descriptors=[
            SkillDescriptor(id="sk_research", name="web_research", description="fetch + summarize"),
        ],
        resolved_skills={"sk_research": ["allhands.builtin.fetch_url"]},
        resolved_fragments=["You are a thorough researcher."],
    )


@pytest.fixture
async def session_maker() -> AsyncIterator[async_sessionmaker]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)

    async with maker() as session, session.begin():
        await SqlEmployeeRepo(session).upsert(_make_emp())
        await SqlConversationRepo(session).create(_make_conv())

    yield maker
    await engine.dispose()


@pytest.mark.asyncio
async def test_repo_round_trips_runtime_across_sessions(session_maker: async_sessionmaker) -> None:
    runtime_in = _activated_runtime()

    async with session_maker() as s, s.begin():
        await SqlSkillRuntimeRepo(s).save("conv1", runtime_in)

    # Fresh session = fresh process · the only way the runtime can come back
    # is through the DB. If the repo forgot to commit, this test fails.
    async with session_maker() as s:
        runtime_out = await SqlSkillRuntimeRepo(s).load("conv1")

    assert runtime_out is not None
    assert runtime_out.base_tool_ids == runtime_in.base_tool_ids
    assert runtime_out.resolved_skills == runtime_in.resolved_skills
    assert runtime_out.resolved_fragments == runtime_in.resolved_fragments
    assert [d.id for d in runtime_out.skill_descriptors] == ["sk_research"]


@pytest.mark.asyncio
async def test_repo_load_returns_none_for_unknown_conversation(
    session_maker: async_sessionmaker,
) -> None:
    async with session_maker() as s:
        runtime = await SqlSkillRuntimeRepo(s).load("does-not-exist")
    assert runtime is None


@pytest.mark.asyncio
async def test_repo_delete_is_idempotent(session_maker: async_sessionmaker) -> None:
    # delete on an empty row must not raise — compact calls this
    # unconditionally on every compact, regardless of whether the runtime
    # had been saved yet.
    async with session_maker() as s, s.begin():
        await SqlSkillRuntimeRepo(s).delete("never-saved")


@pytest.mark.asyncio
async def test_chat_service_cache_miss_falls_through_to_repo(
    session_maker: async_sessionmaker,
) -> None:
    """Simulates uvicorn reload: the cache is empty, the repo has the prior
    runtime, ``get_or_load_runtime`` must restore it.

    ADR 0011 · principle 7 — state checkpointable. If this test fails the
    regression is user-visible (Lead "forgets" activated skills on reload).
    """
    # Session 1: flush a runtime to the repo (as if ChatService ran a turn
    # and persisted at turn end).
    runtime_saved = _activated_runtime()
    async with session_maker() as s, s.begin():
        await SqlSkillRuntimeRepo(s).save("conv1", runtime_saved)

    # Session 2: brand-new ChatService (empty cache) · pulls runtime from repo.
    async with session_maker() as s:
        conv_repo = SqlConversationRepo(s)
        emp_repo = SqlEmployeeRepo(s)
        runtime_repo = SqlSkillRuntimeRepo(s)
        svc = ChatService(
            employee_repo=emp_repo,
            conversation_repo=conv_repo,
            tool_registry=ToolRegistry(),
            skill_registry=SkillRegistry(),
            gate=AutoApproveGate(),
            skill_runtime_repo=runtime_repo,
        )
        # No cache seeded — the only source is the repo.
        emp = await emp_repo.get("emp1")
        assert emp is not None
        runtime = await svc.get_or_load_runtime("conv1", emp)

    assert runtime.resolved_skills == runtime_saved.resolved_skills
    assert runtime.resolved_fragments == runtime_saved.resolved_fragments


@pytest.mark.asyncio
async def test_compact_clears_both_cache_and_repo(session_maker: async_sessionmaker) -> None:
    """compact_conversation must clear both sides. Otherwise a restart after
    compact would resurrect stale resolved skills the user no longer has
    history for (violates P05 · no hidden state surprises).
    """
    # Seed: a persisted runtime with an activated skill.
    runtime = _activated_runtime()
    async with session_maker() as s, s.begin():
        await SqlSkillRuntimeRepo(s).save("conv1", runtime)

    # A fresh ChatService that has cached the runtime (emulate an in-process
    # turn that happened to populate the cache).
    async with session_maker() as s, s.begin():
        conv_repo = SqlConversationRepo(s)
        emp_repo = SqlEmployeeRepo(s)
        runtime_repo = SqlSkillRuntimeRepo(s)
        svc = ChatService(
            employee_repo=emp_repo,
            conversation_repo=conv_repo,
            tool_registry=ToolRegistry(),
            skill_registry=SkillRegistry(),
            gate=AutoApproveGate(),
            skill_runtime_repo=runtime_repo,
        )
        svc._runtime_cache["conv1"] = runtime

        # Seed enough messages that compact will actually drop something.
        from allhands.core import Message

        for i in range(30):
            await conv_repo.append_message(
                Message(
                    id=f"m{i}",
                    conversation_id="conv1",
                    role="user" if i % 2 == 0 else "assistant",
                    content=f"turn {i}",
                    created_at=datetime(2026, 4, 21, 0, i, tzinfo=UTC),
                )
            )

        await svc.compact_conversation("conv1", keep_last=10)

    # Post-compact:
    assert "conv1" not in svc._runtime_cache

    async with session_maker() as s:
        still_there = await SqlSkillRuntimeRepo(s).load("conv1")
    assert still_there is None
