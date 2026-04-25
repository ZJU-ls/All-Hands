"""Contract tests for ``preview_employee_composition`` meta tool (Phase 3B · I-0021).

The meta tool expands a **preset** (UI/contract-layer concept) into the three
persisted columns ``(tool_ids, skill_ids, max_iterations)`` without introducing
a ``mode`` field. Mirrors ``docs/specs/SIGNOFF-agent-runtime-contract.md`` Q6-Q10
and ``docs/specs/agent-runtime-contract.md`` §3 / §4.

§3.2 red line: the response must NOT leak ``mode``/``preset``/``EmployeeKind``.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from allhands.api import create_app
from allhands.api.deps import get_employee_service, get_session
from allhands.persistence.orm.base import Base
from allhands.persistence.sql_repos import SqlEmployeeRepo
from allhands.services.employee_service import EmployeeService


@pytest.fixture
def client() -> TestClient:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    async def _session() -> AsyncIterator[AsyncSession]:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        maker = async_sessionmaker(engine, expire_on_commit=False)
        async with maker() as s:
            yield s

    async def _emp_service(session: AsyncSession = Depends(_session)) -> EmployeeService:
        return EmployeeService(SqlEmployeeRepo(session))

    app = create_app()
    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_employee_service] = _emp_service
    return TestClient(app)


# --- contract expectations (mirror SIGNOFF Q6-Q10 + §4.1) -----------------

EXPECTED_EXECUTE = {
    # 2026-04-25: write_file removed from execute preset (see execute.py
    # comment). User-facing outputs go through allhands.artifacts skill;
    # data/reports/ writes were invisible and competed with artifact_create.
    "tool_ids": [
        "allhands.builtin.fetch_url",
        "allhands.meta.resolve_skill",
        "allhands.meta.read_skill_file",
    ],
    "skill_ids": ["sk_research", "sk_write"],
    "max_iterations": 10,
}

EXPECTED_PLAN = {
    "tool_ids": [
        "allhands.builtin.fetch_url",
        "allhands.meta.plan_create",
        "allhands.meta.plan_update_step",
        "allhands.meta.plan_complete_step",
        "allhands.meta.plan_view",
        "allhands.meta.resolve_skill",
        "allhands.meta.read_skill_file",
    ],
    "skill_ids": ["sk_planner", "sk_research", "sk_write"],
    "max_iterations": 15,
}

# 2026-04-25 user feedback: max raised to 20 (was Q7's 15) for the
# "plan + dispatch + track" workflow's real iteration footprint.
EXPECTED_PLAN_WITH_SUBAGENT = {
    "tool_ids": [
        "allhands.meta.plan_create",
        "allhands.meta.plan_update_step",
        "allhands.meta.plan_complete_step",
        "allhands.meta.plan_view",
        "allhands.meta.spawn_subagent",
        "allhands.meta.resolve_skill",
        "allhands.meta.read_skill_file",
    ],
    "skill_ids": ["sk_planner", "sk_executor_spawn"],
    "max_iterations": 20,
}


# --- meta tool behaviour (direct registry) ---------------------------------


@pytest.mark.parametrize(
    ("preset", "expected"),
    [
        ("execute", EXPECTED_EXECUTE),
        ("plan", EXPECTED_PLAN),
        ("plan_with_subagent", EXPECTED_PLAN_WITH_SUBAGENT),
    ],
)
def test_preview_defaults_match_contract(
    client: TestClient, preset: str, expected: dict[str, object]
) -> None:
    """No custom overrides → expansion matches contract §4.1 defaults."""
    r = client.post("/api/employees/preview", json={"preset": preset})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tool_ids"] == expected["tool_ids"]
    assert body["skill_ids"] == expected["skill_ids"]
    assert body["max_iterations"] == expected["max_iterations"]
    # §3.2 red line: never leak the concept of "mode" in the response.
    assert "mode" not in body
    assert "preset" not in body


def test_preview_plan_with_subagent_is_20(client: TestClient) -> None:
    """User feedback (2026-04-25): plan_with_subagent budget = 20 iter
    (was Q7's 15) to match the actual orchestrator workflow footprint."""
    r = client.post("/api/employees/preview", json={"preset": "plan_with_subagent"})
    assert r.status_code == 200
    assert r.json()["max_iterations"] == 20


def test_preview_custom_tool_ids_appended_to_base(client: TestClient) -> None:
    """``custom_tool_ids`` is additive on top of preset base (dedup preserved)."""
    r = client.post(
        "/api/employees/preview",
        json={
            "preset": "execute",
            "custom_tool_ids": [
                "allhands.meta.dispatch_employee",
                "allhands.builtin.fetch_url",  # duplicate — must dedupe
            ],
        },
    )
    assert r.status_code == 200
    tools = r.json()["tool_ids"]
    # base tools always present
    for t in EXPECTED_EXECUTE["tool_ids"]:
        assert t in tools
    # user-added tool is present exactly once
    assert tools.count("allhands.meta.dispatch_employee") == 1
    # duplicate from base dedup'd
    assert tools.count("allhands.builtin.fetch_url") == 1


def test_preview_custom_skill_ids_override_defaults(client: TestClient) -> None:
    """``custom_skill_ids`` replaces the preset whitelist (user's final picks)."""
    r = client.post(
        "/api/employees/preview",
        json={
            "preset": "execute",
            "custom_skill_ids": ["sk_write"],  # drop sk_research, keep sk_write
        },
    )
    assert r.status_code == 200
    assert r.json()["skill_ids"] == ["sk_write"]


def test_preview_custom_max_iterations_wins(client: TestClient) -> None:
    """``custom_max_iterations`` overrides the preset default when in range."""
    r = client.post(
        "/api/employees/preview",
        json={"preset": "plan", "custom_max_iterations": 25},
    )
    assert r.status_code == 200
    assert r.json()["max_iterations"] == 25


def test_preview_max_iterations_range(client: TestClient) -> None:
    """UI bound: 1 ≤ max_iterations ≤ 10000 (raised from 50 per origin/main 9fb682c)."""
    r_low = client.post(
        "/api/employees/preview", json={"preset": "execute", "custom_max_iterations": 0}
    )
    r_high = client.post(
        "/api/employees/preview",
        json={"preset": "execute", "custom_max_iterations": 10001},
    )
    assert r_low.status_code == 422
    assert r_high.status_code == 422


def test_preview_rejects_unknown_preset(client: TestClient) -> None:
    r = client.post("/api/employees/preview", json={"preset": "lead"})
    # Q10: no `lead` preset in v0.
    assert r.status_code in (400, 422)


def test_preview_rejects_mode_field(client: TestClient) -> None:
    """§3.2 red line: a rogue ``mode`` key in the request → 422."""
    r = client.post(
        "/api/employees/preview",
        json={"preset": "execute", "mode": "execute"},
    )
    assert r.status_code == 422
