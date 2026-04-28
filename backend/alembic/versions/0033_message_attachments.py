"""Add messages.attachment_ids column.

Revision ID: 0033
Revises: 0032
Create Date: 2026-04-28
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("attachment_ids", sa.JSON(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("messages", "attachment_ids")
