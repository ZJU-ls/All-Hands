"""Add ``is_compacted`` soft-flag to messages for dual-view /compact.

Revision ID: 0032
Revises: 0031
Create Date: 2026-04-28

Why (2026-04-28):
Manual ``/compact`` used to ``DELETE FROM message`` for every message older
than the kept tail, which also wiped them from the UI. Users reported the
"老消息凭空消失" bug — render_payloads / tool_calls / images were lost
forever.

The new contract (compact-dual-view.md) keeps the row, flips this column to
``true``, and lets the LLM context build path filter compacted rows out
while the UI keeps showing them behind a "N 条已压缩 · 点击展开" fold.

Backfill is trivially false; we still pass ``server_default`` so existing
SQLite databases don't fail on NOT NULL when read by older snapshots that
cached the old column list. The column is indexed because send_message
reads all messages and filters; the index lets a long conversation still
stay snappy.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column(
            "is_compacted",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.create_index(
        "ix_messages_is_compacted",
        "messages",
        ["is_compacted"],
    )


def downgrade() -> None:
    op.drop_index("ix_messages_is_compacted", table_name="messages")
    op.drop_column("messages", "is_compacted")
