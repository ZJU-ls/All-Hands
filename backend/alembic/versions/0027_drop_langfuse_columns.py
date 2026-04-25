"""drop langfuse credential + bootstrap columns from observability_config

Revision ID: 0027
Revises: 0026
Create Date: 2026-04-25

Langfuse was removed in 2026-04-25 — the platform self-instruments via the
``events`` table. The ``observability_config`` row is repurposed as a small
system-config singleton holding only ``auto_title_enabled``. This migration
drops the now-dead columns; downgrade re-adds them as nullable so a rollback
to pre-removal code keeps working (with empty values) until the next deploy.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


_DROP_COLS = (
    "public_key",
    "secret_key",
    "host",
    "org_id",
    "project_id",
    "admin_email",
    "admin_password",
    "bootstrap_status",
    "bootstrap_error",
    "bootstrapped_at",
)


def upgrade() -> None:
    # SQLite doesn't support multi-DROP COLUMN in a single ALTER, and earlier
    # alembic builds against SQLite need batch_alter_table for column drops.
    with op.batch_alter_table("observability_config") as batch:
        for col in _DROP_COLS:
            batch.drop_column(col)


def downgrade() -> None:
    with op.batch_alter_table("observability_config") as batch:
        batch.add_column(sa.Column("public_key", sa.String(256), nullable=True))
        batch.add_column(sa.Column("secret_key", sa.String(512), nullable=True))
        batch.add_column(sa.Column("host", sa.String(256), nullable=True))
        batch.add_column(sa.Column("org_id", sa.String(128), nullable=True))
        batch.add_column(sa.Column("project_id", sa.String(128), nullable=True))
        batch.add_column(sa.Column("admin_email", sa.String(256), nullable=True))
        batch.add_column(sa.Column("admin_password", sa.String(512), nullable=True))
        batch.add_column(
            sa.Column(
                "bootstrap_status",
                sa.String(32),
                nullable=False,
                server_default="pending",
            )
        )
        batch.add_column(sa.Column("bootstrap_error", sa.String(), nullable=True))
        batch.add_column(
            sa.Column("bootstrapped_at", sa.DateTime(timezone=True), nullable=True)
        )
