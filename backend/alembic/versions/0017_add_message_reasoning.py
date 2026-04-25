"""add messages.reasoning column (trace viewer)

Revision ID: 0017
Revises: 0016
Create Date: 2026-04-21

Persists the per-assistant-message reasoning transcript (Anthropic Extended
Thinking / Qwen3 enable_thinking / DeepSeek-R1 reasoning_content) that the
runner emits as ReasoningEvent. Previously the reasoning lived only on the
wire during streaming; this column lets the trace viewer (docs/specs/
2026-04-21-task-trace-mechanism.md) reconstruct completed runs.

Nullable — historical rows have no reasoning, new assistant messages will
populate it on finalize when the model streamed any thinking-channel text.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("reasoning", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("messages", "reasoning")
