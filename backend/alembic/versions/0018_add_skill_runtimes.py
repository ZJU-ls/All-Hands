"""add skill_runtimes table (per-conversation SkillRuntime checkpoint)

Revision ID: 0018
Revises: 0017
Create Date: 2026-04-21

ADR 0011 · principle 7 state-checkpointable clause: SkillRuntime
(base_tool_ids, skill_descriptors, resolved_skills, resolved_fragments) is
now persisted per-conversation so a uvicorn reload doesn't wipe out
which skills the Lead Agent has activated. Body is a JSON blob of
`SkillRuntime.model_dump()` · conversation_id is PK (1:1 with conversations).

Not FK'd to conversations.id on purpose — compact clears both sides
explicitly, and keeping it standalone avoids cascade surprises during
dev iteration.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "skill_runtimes",
        sa.Column("conversation_id", sa.String(length=64), primary_key=True),
        sa.Column("body", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_skill_runtimes_updated_at",
        "skill_runtimes",
        ["updated_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_skill_runtimes_updated_at", table_name="skill_runtimes")
    op.drop_table("skill_runtimes")
