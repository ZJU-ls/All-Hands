"""Ensure llm_models.capabilities column exists (idempotent healing).

Revision ID: 0039
Revises: 0038
Create Date: 2026-05-05

Why (2026-05-05):
A user hit ``GET /api/models → 503: no such column llm_models.capabilities``
on a workspace whose ``alembic_version`` was already past 0037 but whose
``llm_models`` table never received the column. The most plausible cause
is a branch-merge race during 2026-04-28 (multiple 0033/0034/0035 tables
landed concurrently across worktrees and 0037 + 0038 ran with mixed
migration state).

This migration follows the same "ensure column exists" pattern as 0036
(``ensure_is_compacted``): inspect the live schema, add the column only
if it is missing. Workspaces that already migrated cleanly through 0037
get a no-op; workspaces stuck without the column get healed without a
manual ``alembic stamp`` dance.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("llm_models")}
    if "capabilities" not in cols:
        op.add_column(
            "llm_models",
            sa.Column(
                "capabilities",
                sa.JSON(),
                nullable=False,
                server_default='["chat"]',
            ),
        )


def downgrade() -> None:
    # No-op downgrade: the column is owned by 0037; this migration only
    # heals databases that drifted past 0037 without applying it.
    pass
