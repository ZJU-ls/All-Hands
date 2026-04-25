"""add llm_models table

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-17
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "llm_models",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "provider_id",
            sa.String(64),
            sa.ForeignKey("llm_providers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("display_name", sa.String(128), nullable=False, server_default=""),
        sa.Column("context_window", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.UniqueConstraint("provider_id", "name", name="uq_llm_models_provider_name"),
    )
    op.create_index("ix_llm_models_provider_id", "llm_models", ["provider_id"])
    op.create_index("ix_llm_models_name", "llm_models", ["name"])


def downgrade() -> None:
    op.drop_index("ix_llm_models_name", table_name="llm_models")
    op.drop_index("ix_llm_models_provider_id", table_name="llm_models")
    op.drop_table("llm_models")
