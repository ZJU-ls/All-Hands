"""add llm_providers table

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-17
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "llm_providers",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(128), nullable=False, unique=True),
        sa.Column("base_url", sa.String(512), nullable=False),
        sa.Column("api_key", sa.String(512), nullable=False, server_default=""),
        sa.Column("default_model", sa.String(128), nullable=False, server_default="gpt-4o-mini"),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_index("ix_llm_providers_is_default", "llm_providers", ["is_default"])


def downgrade() -> None:
    op.drop_index("ix_llm_providers_is_default", table_name="llm_providers")
    op.drop_table("llm_providers")
