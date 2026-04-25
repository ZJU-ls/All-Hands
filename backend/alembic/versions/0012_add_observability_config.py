"""add observability_config table (observatory spec § 4.1)

Revision ID: 0012
Revises: 0011
Create Date: 2026-04-19

Single-row table that records the bootstrap status of the embedded Langfuse
instance + the public/secret key pair allhands uses to push traces. The CHECK
(id = 1) clause guards the singleton invariant; the row is seeded by the
migration so the bootstrap service can always `SELECT … WHERE id = 1`.

Spec `docs/specs/agent-design/2026-04-18-observatory.md` calls for
`secret_key_encrypted BYTEA` (AES-256-GCM); v0 ships plaintext to match the
rest of the codebase (providers.api_key is also plaintext today). Encryption
is deferred to a separate cross-cutting effort — once a project-wide secret
helper exists, this column is renamed in a follow-up migration.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "observability_config",
        sa.Column("id", sa.Integer, primary_key=True, server_default="1"),
        sa.Column("public_key", sa.String(256), nullable=True),
        sa.Column("secret_key", sa.String(512), nullable=True),
        sa.Column("host", sa.String(256), nullable=True),
        sa.Column("org_id", sa.String(128), nullable=True),
        sa.Column("project_id", sa.String(128), nullable=True),
        sa.Column("admin_email", sa.String(256), nullable=True),
        sa.Column("admin_password", sa.String(512), nullable=True),
        sa.Column(
            "bootstrap_status",
            sa.String(32),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("bootstrap_error", sa.String, nullable=True),
        sa.Column("bootstrapped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint("id = 1", name="ck_observability_config_singleton"),
    )
    op.execute("INSERT INTO observability_config (id, bootstrap_status) VALUES (1, 'pending')")


def downgrade() -> None:
    op.drop_table("observability_config")
