"""Pin · plan_create / plan_update_step / plan_complete_step / plan_view
all migrate to update_plan / view_plan. Adding a new rename to RENAMES is
the only knob — no test plumbing needed."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from allhands.core import Employee
from allhands.services.tool_id_migrations import (
    RENAMES,
    apply_renames_to_tool_ids,
    migrate_all_employee_tool_ids,
)


def test_plan_create_renames_to_update_plan() -> None:
    out = apply_renames_to_tool_ids(["allhands.meta.plan_create", "allhands.meta.list_skills"])
    assert "allhands.meta.update_plan" in out
    assert "allhands.meta.plan_create" not in out
    assert "allhands.meta.list_skills" in out  # untouched


def test_three_step_plan_tools_collapse_into_one() -> None:
    """The 4-tuple plan_* maps to (update_plan, update_plan, update_plan,
    view_plan) so we expect only 2 distinct ids out, deduped."""
    out = apply_renames_to_tool_ids(
        [
            "allhands.meta.plan_create",
            "allhands.meta.plan_update_step",
            "allhands.meta.plan_complete_step",
            "allhands.meta.plan_view",
        ]
    )
    assert out == ["allhands.meta.update_plan", "allhands.meta.view_plan"]


def test_unrelated_ids_pass_through() -> None:
    ids = [
        "allhands.meta.spawn_subagent",
        "allhands.meta.dispatch_employee",
        "allhands.builtin.fetch_url",
    ]
    assert apply_renames_to_tool_ids(ids) == ids


def test_order_preserved() -> None:
    out = apply_renames_to_tool_ids(
        [
            "allhands.meta.list_employees",
            "allhands.meta.plan_create",  # → update_plan
            "allhands.meta.spawn_subagent",
            "allhands.meta.plan_view",  # → view_plan
        ]
    )
    assert out == [
        "allhands.meta.list_employees",
        "allhands.meta.update_plan",
        "allhands.meta.spawn_subagent",
        "allhands.meta.view_plan",
    ]


def test_dedup_when_input_already_has_target() -> None:
    """If a row already has the new id AND the old id, only the new id
    survives (rename target is deduped against existing entries)."""
    out = apply_renames_to_tool_ids(
        [
            "allhands.meta.update_plan",  # already-new
            "allhands.meta.plan_create",  # → update_plan but dedup
        ]
    )
    assert out.count("allhands.meta.update_plan") == 1


def test_renames_dict_only_contains_known_legacy_ids() -> None:
    """Sanity check: every rename source has the legacy plan_* prefix.
    If you add a new rename, drop a comment in tool_id_migrations.py
    explaining why."""
    for old in RENAMES:
        assert old.startswith("allhands.meta.plan_"), old


class _InMemRepo:
    def __init__(self, employees: list[Employee]) -> None:
        self._data = {e.id: e for e in employees}
        self.upsert_calls: list[Employee] = []

    async def get(self, employee_id: str) -> Employee | None:
        return self._data.get(employee_id)

    async def get_by_name(self, name: str) -> Employee | None:
        return next((e for e in self._data.values() if e.name == name), None)

    async def get_lead(self) -> Employee | None:
        return next((e for e in self._data.values() if e.is_lead_agent), None)

    async def list_all(
        self, *, status: str | None = None, include_archived: bool = False
    ) -> list[Employee]:
        return list(self._data.values())

    async def upsert(self, e: Employee) -> Employee:
        self._data[e.id] = e
        self.upsert_calls.append(e)
        return e

    async def delete(self, employee_id: str) -> None:
        self._data.pop(employee_id, None)


def _emp(name: str, tool_ids: list[str]) -> Employee:
    return Employee(
        id=name,
        name=name,
        description="",
        system_prompt="x",
        model_ref="",
        tool_ids=tool_ids,
        skill_ids=[],
        max_iterations=10,
        is_lead_agent=False,
        status="published",
        created_by="test",
        created_at=datetime.now(UTC),
    )


@pytest.mark.asyncio
async def test_sweep_only_touches_dirty_employees() -> None:
    clean = _emp("clean", ["allhands.meta.list_employees"])
    dirty = _emp("dirty", ["allhands.meta.plan_create"])
    repo = _InMemRepo([clean, dirty])
    fixed = await migrate_all_employee_tool_ids(repo)  # type: ignore[arg-type]
    assert fixed == 1
    assert len(repo.upsert_calls) == 1
    assert repo.upsert_calls[0].name == "dirty"
    assert repo.upsert_calls[0].tool_ids == ["allhands.meta.update_plan"]


@pytest.mark.asyncio
async def test_sweep_idempotent() -> None:
    e = _emp("dup", ["allhands.meta.plan_create", "allhands.meta.plan_view"])
    repo = _InMemRepo([e])
    first = await migrate_all_employee_tool_ids(repo)  # type: ignore[arg-type]
    second = await migrate_all_employee_tool_ids(repo)  # type: ignore[arg-type]
    assert first == 1
    assert second == 0
