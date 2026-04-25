"""extend skills table for install-source metadata

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-18

Adds source / source_url / installed_at / path to `skills`, replaces
single-column uniqueness on `name` with composite uniqueness on (name, version)
so the same skill can coexist at multiple versions. Unique is expressed as a
unique INDEX rather than a CONSTRAINT — SQLite friendly (E06/E07).
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("skills") as batch:
        batch.add_column(
            sa.Column("source", sa.String(32), nullable=False, server_default="builtin")
        )
        batch.add_column(sa.Column("source_url", sa.String(512), nullable=True))
        batch.add_column(sa.Column("installed_at", sa.DateTime, nullable=True))
        batch.add_column(sa.Column("path", sa.String(512), nullable=True))
    op.drop_index("ix_skills_name", table_name="skills")
    op.create_index("ix_skills_name", "skills", ["name"], unique=False)
    op.create_index("uq_skills_name_version", "skills", ["name", "version"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_skills_name_version", table_name="skills")
    op.drop_index("ix_skills_name", table_name="skills")
    op.create_index("ix_skills_name", "skills", ["name"], unique=True)
    with op.batch_alter_table("skills") as batch:
        batch.drop_column("path")
        batch.drop_column("installed_at")
        batch.drop_column("source_url")
        batch.drop_column("source")
