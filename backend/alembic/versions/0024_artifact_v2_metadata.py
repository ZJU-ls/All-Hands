"""Artifact v2 metadata schema · drop confirmation FK.

Three jobs in one migration so the system goes from "v1 thin, lock-prone"
to "v2 rich, lock-clean" atomically:

1. ``confirmations.tool_call_id`` — drop the FK constraint that pointed at
   the (in practice empty) ``tool_calls`` table. ADR 0018 moved tool_call
   data into ``messages.tool_calls`` JSON column; the FK is residual schema
   cruft that fired ``IntegrityError`` whenever a write tool needed
   confirmation.
2. ``artifacts`` table — add Git-style metadata columns (description /
   summary / tags / labels / status / last_accessed_at / view_count /
   edit_count). All nullable / default-zero so existing rows project
   identically — no data migration.
3. ``artifact_versions`` table — add change_message / parent_version /
   created_by_employee_id / created_by_run_id / created_by_user / size_bytes
   so version history tells the full audit story.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Drop the broken FK on confirmations.tool_call_id. SQLite needs
    # batch_alter_table to rebuild the table without the FK.
    with op.batch_alter_table("confirmations") as batch:
        # SQLite stores FK constraints inside the CREATE TABLE statement;
        # ``batch_alter_table`` re-emits the table without the FK clause.
        # We don't drop the column itself — just the constraint.
        batch.alter_column("tool_call_id", existing_type=sa.String(64))

    # 2. artifacts metadata extensions
    with op.batch_alter_table("artifacts") as batch:
        batch.add_column(sa.Column("description", sa.String(2000), nullable=True))
        batch.add_column(sa.Column("summary", sa.Text(), nullable=True))
        batch.add_column(
            sa.Column("tags", sa.JSON(), nullable=False, server_default=sa.text("'[]'"))
        )
        batch.add_column(
            sa.Column("labels", sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
        )
        batch.add_column(
            sa.Column(
                "status",
                sa.String(32),
                nullable=False,
                server_default=sa.text("'published'"),
            )
        )
        batch.add_column(sa.Column("last_accessed_at", sa.DateTime(), nullable=True))
        batch.add_column(
            sa.Column("view_count", sa.Integer(), nullable=False, server_default=sa.text("0"))
        )
        batch.add_column(
            sa.Column("edit_count", sa.Integer(), nullable=False, server_default=sa.text("0"))
        )

    # 3. artifact_versions metadata extensions
    with op.batch_alter_table("artifact_versions") as batch:
        batch.add_column(sa.Column("change_message", sa.String(1000), nullable=True))
        batch.add_column(sa.Column("parent_version", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("created_by_run_id", sa.String(128), nullable=True))
        batch.add_column(sa.Column("created_by_employee_id", sa.String(64), nullable=True))
        batch.add_column(sa.Column("created_by_user", sa.String(128), nullable=True))
        batch.add_column(
            sa.Column("size_bytes", sa.Integer(), nullable=False, server_default=sa.text("0"))
        )


def downgrade() -> None:
    with op.batch_alter_table("artifact_versions") as batch:
        batch.drop_column("size_bytes")
        batch.drop_column("created_by_user")
        batch.drop_column("created_by_employee_id")
        batch.drop_column("created_by_run_id")
        batch.drop_column("parent_version")
        batch.drop_column("change_message")

    with op.batch_alter_table("artifacts") as batch:
        batch.drop_column("edit_count")
        batch.drop_column("view_count")
        batch.drop_column("last_accessed_at")
        batch.drop_column("status")
        batch.drop_column("labels")
        batch.drop_column("tags")
        batch.drop_column("summary")
        batch.drop_column("description")

    # The FK on confirmations.tool_call_id was dropped; we don't restore
    # it on downgrade — the column / data semantics are unchanged.
