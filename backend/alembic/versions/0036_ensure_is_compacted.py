"""Ensure messages.is_compacted exists (idempotent merge of branched 0032s).

Revision ID: 0036
Revises: 0035
Create Date: 2026-04-28

Branch reconciliation: feat/iteration's 0032 added attachments + supports_images;
main's 0032 added messages.is_compacted. After merge, our 0034/0035 own
attachments + attachment_ids; this migration ensures is_compacted is also
present without disturbing existing rows or indexes.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("messages")}
    if "is_compacted" not in cols:
        op.add_column(
            "messages",
            sa.Column(
                "is_compacted",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )
        existing_indexes = {ix["name"] for ix in inspector.get_indexes("messages")}
        if "ix_messages_is_compacted" not in existing_indexes:
            op.create_index("ix_messages_is_compacted", "messages", ["is_compacted"])


def downgrade() -> None:
    op.drop_index("ix_messages_is_compacted", table_name="messages")
    op.drop_column("messages", "is_compacted")
