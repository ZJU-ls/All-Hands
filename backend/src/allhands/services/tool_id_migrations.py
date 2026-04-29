"""Renamed-tool-id migrations · keep employee.tool_ids referencing the
canonical registry ids.

When a tool gets renamed in the registry, every employee row that still
points at the old id silently loses that capability — AgentLoop's
``_active_tool_ids`` warns + skips, but the user sees no surface error
("model knows about plan but never uses it" symptom).

Pattern: keep the rename map here. ``apply_renames_to_tool_ids`` maps a
list of tool ids through the rename, deduping. Called by:

- ``ensure_lead_agent`` on every boot — Lead must never carry stale ids.
- ``migrate_all_employee_tool_ids`` (startup hook) — sweep every other
  employee row + replace stale ids with the new canonical ones.

When you rename a tool: add a single line to ``RENAMES`` and the next boot
heals every existing employee. No migration files, no manual SQL.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from allhands.persistence.repositories import EmployeeRepo

log = logging.getLogger(__name__)


# (old_id) → (new_id) | None to drop. Single source of truth.
#
# 2026-04-28 · plan_tools.py rewrote 4 atomic-step tools into 2
# atomic-replace tools (Claude-Code TodoWrite parity). plan_create +
# plan_update_step + plan_complete_step → update_plan (single tool that
# takes the full todo list each call). plan_view → view_plan (renamed
# only, behaviour identical).
RENAMES: dict[str, str | None] = {
    "allhands.meta.plan_create": "allhands.meta.update_plan",
    "allhands.meta.plan_update_step": "allhands.meta.update_plan",
    "allhands.meta.plan_complete_step": "allhands.meta.update_plan",
    "allhands.meta.plan_view": "allhands.meta.view_plan",
}


def apply_renames_to_tool_ids(tool_ids: list[str]) -> list[str]:
    """Map old ids to new ids · drop renames-to-None · preserve order, dedupe."""
    seen: set[str] = set()
    out: list[str] = []
    for tid in tool_ids:
        new = RENAMES.get(tid, tid)
        if new is None or new in seen:
            continue
        seen.add(new)
        out.append(new)
    return out


async def migrate_all_employee_tool_ids(repo: EmployeeRepo) -> int:
    """Sweep every employee row · rename stale tool ids · upsert if changed.

    Returns the number of employees touched. Called at startup from main.py
    so renamed tools heal automatically without operator intervention.
    """
    employees = await repo.list_all()
    fixed = 0
    for emp in employees:
        new_tools = apply_renames_to_tool_ids(list(emp.tool_ids))
        if new_tools == list(emp.tool_ids):
            continue
        await repo.upsert(emp.model_copy(update={"tool_ids": new_tools}))
        fixed += 1
        log.info(
            "tool_ids.migrate · %s · %d tools after rename",
            emp.name,
            len(new_tools),
        )
    return fixed
