"""add user_inputs table for clarification flow (ADR 0019 C3)

Revision ID: 0021
Revises: 0020
Create Date: 2026-04-25
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_inputs",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("tool_call_id", sa.String(length=64), nullable=False, unique=True),
        sa.Column("questions_json", sa.JSON(), nullable=False),
        sa.Column("answers_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_user_inputs_tool_call_id", "user_inputs", ["tool_call_id"])
    op.create_index("ix_user_inputs_status", "user_inputs", ["status"])
    op.create_index("ix_user_inputs_created_at", "user_inputs", ["created_at"])
    op.create_index("ix_user_inputs_expires_at", "user_inputs", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_user_inputs_expires_at", table_name="user_inputs")
    op.drop_index("ix_user_inputs_created_at", table_name="user_inputs")
    op.drop_index("ix_user_inputs_status", table_name="user_inputs")
    op.drop_index("ix_user_inputs_tool_call_id", table_name="user_inputs")
    op.drop_table("user_inputs")
