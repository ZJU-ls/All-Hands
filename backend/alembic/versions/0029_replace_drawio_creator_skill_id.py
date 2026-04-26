"""Replace allhands.drawio-creator skill id with allhands.artifacts.

Revision ID: 0029
Revises: 0028
Create Date: 2026-04-26

Background:
``allhands.drawio-creator`` was merged into ``allhands.artifacts`` (P3 of the
artifacts unification refactor). The old skill no longer exists on disk; any
employee or runtime row that references it would resolve to "skill not found"
on activation — silently broken at best, hard fail at worst.

What this migration does:
1. ``employees.skill_ids`` — JSON list[str]. Replace 'allhands.drawio-creator'
   with 'allhands.artifacts'. De-dup so one employee doesn't end up with the
   target id twice.
2. ``skill_runtimes.body`` — JSON blob. Walk the structure and rewrite any
   string occurrence of the old id (descriptors / activated_skills /
   selected_tools etc.) to the new id.

Idempotent: re-running is safe (no-op once the strings are gone).

The downgrade is a no-op — we can't faithfully reverse a many-to-one merge,
and the old skill is physically gone. Roll forward only.
"""

from __future__ import annotations

import json
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None

OLD_ID = "allhands.drawio-creator"
NEW_ID = "allhands.artifacts"


def _replace_in_value(value: Any) -> tuple[Any, bool]:
    """Recursively walk a JSON-decoded value, replacing OLD_ID with NEW_ID.

    Returns (new_value, changed). `changed` lets the caller skip the rewrite
    when nothing matches — keeps the migration cheap on clean databases.
    """
    if isinstance(value, str):
        if value == OLD_ID:
            return NEW_ID, True
        return value, False
    if isinstance(value, list):
        out_list: list[Any] = []
        any_changed = False
        for item in value:
            new_item, changed = _replace_in_value(item)
            any_changed = any_changed or changed
            out_list.append(new_item)
        # de-dup at list level if NEW_ID would now appear twice and the
        # list looks like an id-set (all strings)
        if any_changed and all(isinstance(x, str) for x in out_list):
            seen: set[str] = set()
            deduped: list[str] = []
            for item in out_list:
                if item not in seen:
                    seen.add(item)
                    deduped.append(item)
            return deduped, True
        return out_list, any_changed
    if isinstance(value, dict):
        out_dict: dict[Any, Any] = {}
        any_changed = False
        for k, v in value.items():
            new_v, changed = _replace_in_value(v)
            any_changed = any_changed or changed
            out_dict[k] = new_v
        return out_dict, any_changed
    return value, False


def upgrade() -> None:
    bind = op.get_bind()

    # 1) employees.skill_ids
    rows = bind.execute(sa.text("SELECT id, skill_ids FROM employees")).fetchall()
    for row_id, raw in rows:
        # SQLAlchemy's JSON type round-trips through Python lists for SQLite/Postgres
        if raw is None:
            continue
        if isinstance(raw, str):
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                continue
        else:
            parsed = raw
        new_value, changed = _replace_in_value(parsed)
        if not changed:
            continue
        bind.execute(
            sa.text("UPDATE employees SET skill_ids = :v WHERE id = :id"),
            {"v": json.dumps(new_value), "id": row_id},
        )

    # 2) skill_runtimes.body
    rows = bind.execute(
        sa.text("SELECT conversation_id, body FROM skill_runtimes")
    ).fetchall()
    for conv_id, raw in rows:
        if raw is None:
            continue
        if isinstance(raw, str):
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                continue
        else:
            parsed = raw
        new_value, changed = _replace_in_value(parsed)
        if not changed:
            continue
        bind.execute(
            sa.text(
                "UPDATE skill_runtimes SET body = :v WHERE conversation_id = :id"
            ),
            {"v": json.dumps(new_value), "id": conv_id},
        )


def downgrade() -> None:
    # Intentional no-op. The old skill is physically gone; reverting strings
    # would create dangling references. If you really need a downgrade, the
    # operator should restore the drawio-creator skill files first.
    pass
