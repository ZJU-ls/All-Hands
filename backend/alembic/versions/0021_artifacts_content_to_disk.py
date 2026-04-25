"""Move artifact content from DB columns to disk.

Background: ``artifacts.content`` and ``artifact_versions.content`` were
SQLite TEXT columns holding 5KB-1MB blobs. Under chat-side write
contention this caused "database is locked" on long write transactions.

Decision: all artifact content lives on disk under
``data/artifacts/<workspace>/<artifact_id>/v<N>.<ext>`` (was already true
for binary kinds; now true for text too). DB rows only carry metadata +
``file_path`` (now NOT NULL).

Existing data: dropped. Per user direction (2026-04-25), local-deployment
artifacts at this stage are throwaway. A no-data-migration path keeps this
revision simple and idempotent. Re-running on a fresh DB is a no-op for
content (nothing to move).
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # Nuke rows so the NOT NULL constraint we add below doesn't trip on
    # existing rows whose ``file_path`` was NULL (text-kind artifacts).
    # Per user direction: local artifacts at this stage are disposable.
    bind.execute(sa.text("DELETE FROM artifact_versions"))
    bind.execute(sa.text("DELETE FROM artifacts"))

    with op.batch_alter_table("artifacts") as batch:
        batch.drop_column("content")
        batch.alter_column("file_path", existing_type=sa.String(512), nullable=False)

    with op.batch_alter_table("artifact_versions") as batch:
        batch.drop_column("content")
        batch.alter_column("file_path", existing_type=sa.String(512), nullable=False)


def downgrade() -> None:
    # Restore the old columns; data not recovered (per upgrade's nuke).
    with op.batch_alter_table("artifacts") as batch:
        batch.add_column(sa.Column("content", sa.Text(), nullable=True))
        batch.alter_column("file_path", existing_type=sa.String(512), nullable=True)

    with op.batch_alter_table("artifact_versions") as batch:
        batch.add_column(sa.Column("content", sa.Text(), nullable=True))
        batch.alter_column("file_path", existing_type=sa.String(512), nullable=True)
