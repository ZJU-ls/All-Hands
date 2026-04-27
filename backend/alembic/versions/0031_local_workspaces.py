"""Add local_workspaces table for the local-files skill.

Revision ID: 0031
Revises: 0030
Create Date: 2026-04-27

A LocalWorkspace registers a host directory the local-files skill is allowed
to read / edit / shell into. Default zero-rows posture: all 7 file tools
return ``error="no workspace configured"`` until the user adds one in
``/settings/workspaces``.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "local_workspaces",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("root_path", sa.String(length=1024), nullable=False),
        sa.Column(
            "read_only", sa.Boolean(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("denied_globs", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_local_workspaces_name",
        "local_workspaces",
        ["name"],
        unique=True,
    )
    op.create_index(
        "ix_local_workspaces_created_at",
        "local_workspaces",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_local_workspaces_created_at", table_name="local_workspaces")
    op.drop_index("ix_local_workspaces_name", table_name="local_workspaces")
    op.drop_table("local_workspaces")
