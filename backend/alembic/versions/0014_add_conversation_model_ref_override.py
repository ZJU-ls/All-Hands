"""add conversations.model_ref_override column (Track ζ)

Revision ID: 0014
Revises: 0013
Create Date: 2026-04-20

Adds a nullable per-conversation model override. Null means "inherit the
employee's model_ref"; any other string shape is `<provider_name>/<model_name>`
(same shape as Employee.model_ref).
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column("model_ref_override", sa.String(256), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("conversations", "model_ref_override")
