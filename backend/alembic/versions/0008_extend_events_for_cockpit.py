"""extend events table for cockpit (Wave C · cockpit)

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-18

cockpit spec § 7 shares the ``events`` table with triggers (§ 4.1). Triggers
landed first with the minimum columns (`id/kind/payload/published_at/trigger_id`);
cockpit needs the activity-feed projection columns: actor / subject / severity /
link / workspace_id. `published_at` serves as the `ts` column from the spec.

SQLite ADD COLUMN with server_default for non-null columns, so existing rows
get a sane value without a backfill.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("events", sa.Column("actor", sa.String(128), nullable=True))
    op.add_column("events", sa.Column("subject", sa.String(128), nullable=True))
    op.add_column(
        "events",
        sa.Column("severity", sa.String(16), nullable=False, server_default="info"),
    )
    op.add_column("events", sa.Column("link", sa.String(512), nullable=True))
    op.add_column(
        "events",
        sa.Column("workspace_id", sa.String(64), nullable=False, server_default="default"),
    )
    op.create_index(
        "idx_events_workspace_time",
        "events",
        ["workspace_id", "published_at"],
    )
    op.create_index(
        "idx_events_workspace_kind",
        "events",
        ["workspace_id", "kind", "published_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_events_workspace_kind", table_name="events")
    op.drop_index("idx_events_workspace_time", table_name="events")
    op.drop_column("events", "workspace_id")
    op.drop_column("events", "link")
    op.drop_column("events", "severity")
    op.drop_column("events", "subject")
    op.drop_column("events", "actor")
