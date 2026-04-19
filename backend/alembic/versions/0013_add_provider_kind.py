"""add llm_providers.kind column (provider format dispatch)

Revision ID: 0013
Revises: 0012
Create Date: 2026-04-19

Adds a `kind` column for dispatching between OpenAI-compat, Anthropic, and
Aliyun (DashScope compat-mode). Existing rows are backfilled with 'openai'
to preserve current behavior — they've all been running ChatOpenAI up to now.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "llm_providers",
        sa.Column("kind", sa.String(32), nullable=False, server_default="openai"),
    )


def downgrade() -> None:
    op.drop_column("llm_providers", "kind")
