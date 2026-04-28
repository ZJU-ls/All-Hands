"""Add attachments table for chat-message file/image upload.

Revision ID: 0032
Revises: 0031
Create Date: 2026-04-28
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0034"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "attachments",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("mime", sa.String(length=128), nullable=False),
        sa.Column("filename", sa.String(length=256), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_path", sa.String(length=512), nullable=False),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("conversation_id", sa.String(length=64), nullable=True),
        sa.Column("uploaded_by", sa.String(length=64), nullable=False, server_default="user"),
        sa.Column("extracted_text", sa.Text(), nullable=True),
        sa.Column("extracted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_attachments_sha256", "attachments", ["sha256"])
    op.create_index("ix_attachments_conversation", "attachments", ["conversation_id"])
    op.create_index("ix_attachments_created_at", "attachments", ["created_at"])

    # Vision-capability flag on llm_models for capability-aware projection.
    op.add_column(
        "llm_models",
        sa.Column("supports_images", sa.Boolean(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("llm_models", "supports_images")
    op.drop_index("ix_attachments_created_at", table_name="attachments")
    op.drop_index("ix_attachments_conversation", table_name="attachments")
    op.drop_index("ix_attachments_sha256", table_name="attachments")
    op.drop_table("attachments")
