"""add artifacts + artifact_versions tables (Wave C · artifacts-skill)

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-18

artifacts-skill spec § 3.2 — long-lived agent-produced products. Two tables:
- `artifacts`: current version of each artifact, one row
- `artifact_versions`: history (append-only)

Soft-delete via `deleted_at`. Content lives inline for TEXT kinds, on-disk for
BINARY kinds (tracked via `file_path`, always relative to backend/data/artifacts/).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "artifacts",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("workspace_id", sa.String(64), nullable=False),
        sa.Column("name", sa.String(256), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("mime_type", sa.String(128), nullable=False),
        sa.Column("content", sa.String, nullable=True),
        sa.Column("file_path", sa.String(512), nullable=True),
        sa.Column("size_bytes", sa.Integer, nullable=False, server_default="0"),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("pinned", sa.Boolean, nullable=False, server_default=sa.text("0")),
        sa.Column("deleted_at", sa.DateTime, nullable=True),
        sa.Column("created_by_run_id", sa.String(128), nullable=True),
        sa.Column("created_by_employee_id", sa.String(64), nullable=True),
        sa.Column("conversation_id", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("updated_at", sa.DateTime, nullable=False),
        sa.Column("metadata", sa.JSON, nullable=False, server_default="{}"),
    )
    op.create_index("idx_artifacts_workspace", "artifacts", ["workspace_id", "deleted_at"])
    op.create_index("idx_artifacts_conversation", "artifacts", ["conversation_id"])
    op.create_index("idx_artifacts_kind", "artifacts", ["kind"])
    op.create_index("idx_artifacts_pinned", "artifacts", ["pinned"])

    op.create_table(
        "artifact_versions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "artifact_id",
            sa.String(64),
            sa.ForeignKey("artifacts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("content", sa.String, nullable=True),
        sa.Column("file_path", sa.String(512), nullable=True),
        sa.Column("diff_from_prev", sa.String, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.UniqueConstraint("artifact_id", "version", name="uq_artifact_versions_artifact_version"),
    )
    op.create_index("idx_artifact_versions_artifact", "artifact_versions", ["artifact_id"])


def downgrade() -> None:
    op.drop_index("idx_artifact_versions_artifact", table_name="artifact_versions")
    op.drop_table("artifact_versions")
    op.drop_index("idx_artifacts_pinned", table_name="artifacts")
    op.drop_index("idx_artifacts_kind", table_name="artifacts")
    op.drop_index("idx_artifacts_conversation", table_name="artifacts")
    op.drop_index("idx_artifacts_workspace", table_name="artifacts")
    op.drop_table("artifacts")
