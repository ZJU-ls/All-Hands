"""add triggers + trigger_fires + events tables (Wave B.3)

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-18

triggers spec § 3.3. events table is shared with cockpit (§ 4.1); migration
lives here because triggers is the primary consumer. JSON columns because
SQLite has no JSONB; dialect-agnostic for later Postgres port.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "triggers",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("enabled", sa.Boolean, nullable=False, default=True),
        sa.Column("timer", sa.JSON, nullable=True),
        sa.Column("event", sa.JSON, nullable=True),
        sa.Column("action", sa.JSON, nullable=False),
        sa.Column("min_interval_seconds", sa.Integer, nullable=False, default=300),
        sa.Column("fires_total", sa.Integer, nullable=False, default=0),
        sa.Column("fires_failed_streak", sa.Integer, nullable=False, default=0),
        sa.Column("last_fired_at", sa.DateTime, nullable=True),
        sa.Column("auto_disabled_reason", sa.String(512), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
    )
    op.create_index("idx_triggers_kind_enabled", "triggers", ["kind", "enabled"])

    op.create_table(
        "trigger_fires",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "trigger_id",
            sa.String(64),
            sa.ForeignKey("triggers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("fired_at", sa.DateTime, nullable=False),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("event_payload", sa.JSON, nullable=True),
        sa.Column("action_snapshot", sa.JSON, nullable=False),
        sa.Column("rendered_task", sa.String(8000), nullable=True),
        sa.Column("run_id", sa.String(128), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, default="queued"),
        sa.Column("error_code", sa.String(64), nullable=True),
        sa.Column("error_detail", sa.String(2000), nullable=True),
    )
    op.create_index(
        "idx_trigger_fires_trigger_time",
        "trigger_fires",
        ["trigger_id", "fired_at"],
    )

    op.create_table(
        "events",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("kind", sa.String(128), nullable=False),
        sa.Column("payload", sa.JSON, nullable=False),
        sa.Column("published_at", sa.DateTime, nullable=False),
        sa.Column("trigger_id", sa.String(64), nullable=True),
    )
    op.create_index("idx_events_kind_time", "events", ["kind", "published_at"])


def downgrade() -> None:
    op.drop_index("idx_events_kind_time", table_name="events")
    op.drop_table("events")
    op.drop_index("idx_trigger_fires_trigger_time", table_name="trigger_fires")
    op.drop_table("trigger_fires")
    op.drop_index("idx_triggers_kind_enabled", table_name="triggers")
    op.drop_table("triggers")
