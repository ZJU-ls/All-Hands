"""add auto_title_enabled flag to observability_config

Revision ID: 0021
Revises: 0020
Create Date: 2026-04-25

The `observability_config` row doubles as the platform's single-row system
config since v1 (no general-purpose system_config table exists yet). This
migration adds the `auto_title_enabled` toggle that gates LLM-based
conversation-title generation; see `services/chat_service.py` for the read
site. Default ``False`` so behaviour stays identical to pre-v1: title falls
back to a truncated copy of the user's first message.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0021_auto_title"
down_revision = "0021_user_inputs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "observability_config",
        sa.Column(
            "auto_title_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("observability_config", "auto_title_enabled")
