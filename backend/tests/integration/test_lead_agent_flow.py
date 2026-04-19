"""Lead-agent happy-path smoke (I-0011 · agent-design § 11 DoD).

Walks the "Lead discovers → dispatches → observes" chain at the service layer
so a regression in the wiring (missing meta tools, broken invariants, or
registry loss) fails loudly without needing a live LLM.

Scope:
  1. ``discover_builtin_tools`` registers the Meta Tools the Lead needs
     (``list_employees`` / ``get_employee_detail`` / ``dispatch_employee``).
  2. ``EmployeeService.create(is_lead_agent=True)`` auto-injects the three
     coordination tool ids (agent-design § 7 invariant).
  3. A non-Lead "worker" employee can be created + listed alongside the Lead
     via the same repo the ``list_employees`` meta tool reads.
  4. The dispatch tool can be resolved from the registry for a worker by id —
     the final LangGraph/LLM round-trip is xfailed until the end-to-end
     ``AgentRunner`` acceptance harness lands (spec § 11 bullet 1).

Why integration and not unit:
  unit/test_services covers EmployeeService in isolation with mocks; this file
  binds the real SQL repo + ToolRegistry + EmployeeService together so drift
  between those pieces (e.g. a renamed tool id) surfaces here instead of
  silently leaving a dead pointer.

spec: ``docs/specs/agent-design/2026-04-18-agent-design.md § 11``
issue: ``docs/issues/closed/I-0011-missing-integration-e2e-tests.md``
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from allhands.execution.registry import ToolRegistry
from allhands.execution.tools import discover_builtin_tools
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlEmployeeRepo
from allhands.services.employee_service import (
    COORDINATION_TOOL_IDS,
    DISPATCH_TOOL_ID,
    EmployeeService,
)


@pytest.fixture
async def session_maker() -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
def registry() -> ToolRegistry:
    r = ToolRegistry()
    discover_builtin_tools(r)
    return r


async def test_lead_flow_lists_and_dispatches(
    session_maker: async_sessionmaker[AsyncSession],
    registry: ToolRegistry,
) -> None:
    """End-to-end the cheap way: Lead + worker via real repo + registry.

    Covers the spec's Lead-coordination invariant (§ 7) without hitting an LLM:
      - Lead auto-mounts all 3 coordination tools
      - list_employees sees Lead + worker
      - dispatch_employee tool is resolvable for the worker id
    """
    async with session_maker() as session, session.begin():
        svc = EmployeeService(SqlEmployeeRepo(session))

        lead = await svc.create(
            name="Lead",
            description="Lead agent",
            system_prompt="You coordinate the team.",
            model_ref="openai/gpt-4o-mini",
            tool_ids=[],
            skill_ids=["allhands.render"],
            is_lead_agent=True,
        )
        for tid in COORDINATION_TOOL_IDS:
            assert tid in lead.tool_ids, (
                f"Lead invariant: {tid} must be auto-injected (agent-design § 7)"
            )

        worker = await svc.create(
            name="Researcher",
            description="A web researcher",
            system_prompt="You do research.",
            model_ref="openai/gpt-4o-mini",
            tool_ids=["allhands.builtin.fetch_url"],
            skill_ids=[],
        )

        all_employees = await svc.list_all()
        names = {e.name for e in all_employees}
        assert {"Lead", "Researcher"} <= names

        worker_lookup = await svc.get_by_name("Researcher")
        assert worker_lookup is not None
        assert worker_lookup.id == worker.id

        dispatch_tool, dispatch_exec = registry.get(DISPATCH_TOOL_ID)
        assert dispatch_tool.name == "dispatch_employee"
        assert "employee_id" in dispatch_tool.input_schema["properties"]
        assert callable(dispatch_exec)


async def test_lead_flow_rejects_sub_lead_without_coordination(
    session_maker: async_sessionmaker[AsyncSession],
) -> None:
    """Sub-lead pattern invariant: mounting dispatch_employee on a non-Lead
    employee without list + detail tools raises (agent-design § 7)."""
    from allhands.core import InvariantViolation

    async with session_maker() as session, session.begin():
        svc = EmployeeService(SqlEmployeeRepo(session))

        with pytest.raises(InvariantViolation, match="coordination tool"):
            await svc.create(
                name="BadSubLead",
                description="dispatches but can't see peers",
                system_prompt="x",
                model_ref="openai/gpt-4o-mini",
                tool_ids=[DISPATCH_TOOL_ID],
                skill_ids=[],
            )


@pytest.mark.xfail(
    reason=(
        "agent-design § 11 bullet 1: full Lead → list → dispatch → result "
        "round-trip requires the AgentRunner + fake model gateway harness. "
        "Tracked as follow-up; this file pins the service-layer half."
    ),
    strict=True,
)
async def test_lead_flow_runner_round_trip_through_fake_llm() -> None:
    """Placeholder for the full LangGraph-level run:

      1. build AgentRunner(lead_employee, registry, FakeModelGateway, ...)
      2. feed a user message that forces list_employees + dispatch_employee
      3. assert: sub-run emits nested_run_start/end events, parent run sees
         the tool result, final assistant message references the dispatched
         employee by name.

    Until the FakeModelGateway + AgentRunner wiring lands in tests/, this
    xfails on purpose so the gap stays visible in every CI run.
    """
    raise NotImplementedError("full runner round-trip awaits fake gateway harness")
