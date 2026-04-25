"""Add messages.interrupted column for partial-turn preservation.

When the LLM stream is cut short (user 中止 / network drop / backend
error mid-stream) we now persist whatever was already streamed AND mark
the row interrupted=True. UI renders an 「已中止」 tail; build_llm_context
synthesizes "Interrupted by user" tool_results for any orphan tool_use
blocks on the next turn.

Default false so all existing rows continue to project as completed
turns — the flag is opt-in to the new behaviour.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("messages") as batch:
        batch.add_column(
            sa.Column(
                "interrupted",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("messages") as batch:
        batch.drop_column("interrupted")
