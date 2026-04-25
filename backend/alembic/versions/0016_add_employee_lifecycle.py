"""add employee lifecycle columns (status + published_at)

Revision ID: 0016
Revises: 0015
Create Date: 2026-04-20

Employees become first-class resources with a draft/published lifecycle.
Seeds and existing rows are grandfathered as ``published`` with
``published_at = created_at`` so the Employees browse page (which only
lists published rows) keeps the same content pre- and post-migration.

New employees POSTed from the API default to ``draft`` so they can be
iterated on in ``/employees/design`` without showing up on the main
browse page until the user explicitly publishes.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "employees",
        sa.Column(
            "status",
            sa.String(length=32),
            nullable=False,
            server_default="published",
        ),
    )
    op.add_column(
        "employees",
        sa.Column("published_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_employees_status", "employees", ["status"])
    # Grandfather existing rows: every pre-migration employee is treated
    # as already-published so the /employees browse page keeps working.
    op.execute(
        "UPDATE employees SET status = 'published', "
        "published_at = created_at "
        "WHERE published_at IS NULL"
    )


def downgrade() -> None:
    op.drop_index("ix_employees_status", table_name="employees")
    op.drop_column("employees", "published_at")
    op.drop_column("employees", "status")
