"""add agent_plans table (Wave A · Plan family)

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-18

agent-design § 5.1 — conversation-scoped Plan owned by an employee. Steps
stored as JSON (SQLite has no JSONB; dialect-agnostic). Index on conversation
FK for the typical access pattern (look up a plan by current conversation).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_plans",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.String(64),
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("run_id", sa.String(128), nullable=True),
        sa.Column("owner_employee_id", sa.String(64), nullable=False),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("steps", sa.JSON, nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
    )
    op.create_index(
        "idx_agent_plans_conversation", "agent_plans", ["conversation_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("idx_agent_plans_conversation", table_name="agent_plans")
    op.drop_table("agent_plans")
