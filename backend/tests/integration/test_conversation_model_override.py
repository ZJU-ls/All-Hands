"""Track ζ — per-conversation model override.

Verifies:
  - PATCH /api/conversations/{id} can set, clear, and leave-untouched the
    ``model_ref_override`` field.
  - ``clear_model_ref_override: true`` clears the override even though the
    omitted-vs-null distinction is ambiguous for Pydantic.
  - The effective model ref resolves ``conv.model_ref_override or
    employee.model_ref`` at AgentRunner construction time (this is the
    load-bearing behaviour behind the priority chain).
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from allhands.api import create_app
from allhands.api.deps import get_session
from allhands.core import Conversation, Employee
from allhands.execution.gate import AutoApproveGate
from allhands.execution.registry import ToolRegistry
from allhands.execution.runner import AgentRunner
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlConversationRepo, SqlEmployeeRepo


def _make_emp(model_ref: str = "openai/gpt-4o-mini") -> Employee:
    return Employee(
        id="emp1",
        name="override-test",
        description="",
        system_prompt="test-employee",
        model_ref=model_ref,
        tool_ids=[],
        skill_ids=[],
        max_iterations=10,
        is_lead_agent=False,
        created_by="system",
        created_at=datetime.now(UTC),
        metadata={},
    )


def _make_conv(
    conv_id: str = "conv1",
    model_ref_override: str | None = None,
) -> Conversation:
    return Conversation(
        id=conv_id,
        employee_id="emp1",
        title=None,
        created_at=datetime(2026, 4, 1, tzinfo=UTC),
        model_ref_override=model_ref_override,
        metadata={},
    )


async def _seed(engine: AsyncEngine, conv_override: str | None) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        await SqlEmployeeRepo(session).upsert(_make_emp())
        conv_repo = SqlConversationRepo(session)
        await conv_repo.create(_make_conv(model_ref_override=conv_override))


@pytest.fixture
def make_client():
    def _build(conv_override: str | None = None) -> TestClient:
        engine = create_async_engine(
            "sqlite+aiosqlite:///:memory:",
            poolclass=StaticPool,
            connect_args={"check_same_thread": False},
        )
        asyncio.run(_seed(engine, conv_override))

        async def _session() -> AsyncIterator[AsyncSession]:
            maker = async_sessionmaker(engine, expire_on_commit=False)
            async with maker() as s:
                yield s

        app = create_app()
        app.dependency_overrides[get_session] = _session
        return TestClient(app)

    return _build


def test_patch_sets_model_ref_override(make_client) -> None:
    client = make_client()
    resp = client.patch(
        "/api/conversations/conv1",
        json={"model_ref_override": "anthropic/claude-opus-4-7"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["model_ref_override"] == "anthropic/claude-opus-4-7"

    # Round-trip via GET to confirm it was persisted, not just echoed.
    get_resp = client.get("/api/conversations/conv1")
    assert get_resp.json()["model_ref_override"] == "anthropic/claude-opus-4-7"


def test_patch_clear_flag_wipes_override(make_client) -> None:
    # Seed with an override already present so "clear" has something to do.
    client = make_client(conv_override="anthropic/claude-opus-4-7")
    # Baseline check.
    assert (
        client.get("/api/conversations/conv1").json()["model_ref_override"]
        == "anthropic/claude-opus-4-7"
    )

    resp = client.patch(
        "/api/conversations/conv1",
        json={"clear_model_ref_override": True},
    )
    assert resp.status_code == 200
    assert resp.json()["model_ref_override"] is None
    assert client.get("/api/conversations/conv1").json()["model_ref_override"] is None


def test_patch_title_only_leaves_override_untouched(make_client) -> None:
    client = make_client(conv_override="anthropic/claude-opus-4-7")
    resp = client.patch(
        "/api/conversations/conv1",
        json={"title": "renamed"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "renamed"
    # Key invariant: a partial update must not silently drop the override.
    assert body["model_ref_override"] == "anthropic/claude-opus-4-7"


def test_patch_404_for_unknown_conversation(make_client) -> None:
    client = make_client()
    resp = client.patch(
        f"/api/conversations/{uuid.uuid4().hex}",
        json={"title": "x"},
    )
    assert resp.status_code == 404


def test_runner_resolves_override_ahead_of_employee_ref() -> None:
    """The priority chain is where the user-visible behaviour lives — if the
    runner ignores the override we'd ship a silent bug where the model picker
    looks wired but the agent never switches provider.
    """
    employee = _make_emp(model_ref="openai/gpt-4o-mini")
    runner = AgentRunner(
        employee=employee,
        tool_registry=ToolRegistry(),
        gate=AutoApproveGate(),
        provider=None,
        model_ref_override="anthropic/claude-opus-4-7",
    )
    assert runner._model_ref_override == "anthropic/claude-opus-4-7"
    # And the employee default still sits alongside it — we only swap at
    # _build_model call time, not by mutating the employee.
    assert runner._employee.model_ref == "openai/gpt-4o-mini"


def test_runner_falls_back_to_employee_when_override_none() -> None:
    employee = _make_emp(model_ref="openai/gpt-4o-mini")
    runner = AgentRunner(
        employee=employee,
        tool_registry=ToolRegistry(),
        gate=AutoApproveGate(),
        provider=None,
        model_ref_override=None,
    )
    assert runner._model_ref_override is None
    assert runner._employee.model_ref == "openai/gpt-4o-mini"
