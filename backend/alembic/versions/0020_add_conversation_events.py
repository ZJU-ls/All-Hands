"""add conversation_events table (append-only event log)

Revision ID: 0020
Revises: 0019
Create Date: 2026-04-24

ADR 0017 · Claude Code alignment: MessageRepo becomes a projection cache.
The authoritative source of truth for conversation history is now the
``conversation_events`` table — append-only, ordered by ``sequence`` per
conversation, rich ``content_json`` payload.

Mirrors Claude Code's `{sessionId}.jsonl` approach (ref-src-claude/V11):
- Append-only: no UPDATE, no DELETE (rows can be soft-flagged
  ``is_compacted`` but stay queryable)
- ``parent_id`` establishes DAG structure for branch / fork / regenerate
- ``subagent_id`` separates sidechain events (Claude's
  ``agent-{agentId}.jsonl``) from main conversation
- ``turn_id`` groups events that belong to the same assistant turn
  (TURN_STARTED → ... → TURN_COMPLETED | TURN_ABORTED)
- ``idempotency_key`` + UNIQUE index lets clients safely retry

Schema designed to be Postgres-ready (UUID string, JSON column) so P4.A
migration is a driver swap, not a rewrite.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "conversation_events",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("conversation_id", sa.String(length=64), nullable=False),
        sa.Column("parent_id", sa.String(length=64), nullable=True),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=48), nullable=False),
        sa.Column("content_json", sa.JSON(), nullable=False),
        sa.Column("subagent_id", sa.String(length=64), nullable=True),
        sa.Column("turn_id", sa.String(length=64), nullable=True),
        sa.Column("idempotency_key", sa.String(length=128), nullable=True),
        sa.Column("is_compacted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    # Covering index for the hot read path: list_by_conversation ordered.
    op.create_index(
        "ix_conversation_events_conv_seq",
        "conversation_events",
        ["conversation_id", "sequence"],
        unique=True,
    )
    # Subagent sidechain filter.
    op.create_index(
        "ix_conversation_events_subagent",
        "conversation_events",
        ["conversation_id", "subagent_id", "sequence"],
    )
    # Turn-level queries (orphan scan, turn lookup).
    op.create_index(
        "ix_conversation_events_turn",
        "conversation_events",
        ["turn_id"],
    )
    # Idempotency guard: a client retry with the same key must never
    # insert twice. Scope to conversation because keys are per-client.
    op.create_index(
        "ix_conversation_events_idempotency",
        "conversation_events",
        ["conversation_id", "idempotency_key"],
        unique=True,
        sqlite_where=sa.text("idempotency_key IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_conversation_events_idempotency", table_name="conversation_events")
    op.drop_index("ix_conversation_events_turn", table_name="conversation_events")
    op.drop_index("ix_conversation_events_subagent", table_name="conversation_events")
    op.drop_index("ix_conversation_events_conv_seq", table_name="conversation_events")
    op.drop_table("conversation_events")
