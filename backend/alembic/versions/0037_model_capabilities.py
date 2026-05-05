"""Add capabilities JSON column to llm_models.

Revision ID: 0033
Revises: 0032
Create Date: 2026-04-28

Why (2026-04-28):
A single LLMProvider (e.g. OpenAI) hosts both chat models (gpt-4o-mini)
AND image-generation models (gpt-image-1.5). The chat-only assumption is
baked into the model picker today: ``capabilities`` is the surgical
addition that lets the same provider register multiple model kinds without
forking provider tables.

Backwards-compat:
- ``server_default='["chat"]'`` so every existing row materializes as a
  chat model on first read.
- ``nullable=False`` after backfill: the application invariant is "every
  registered model declares at least one capability".
- JSON column (vs typed enum array) is portable across sqlite + postgres.

The picker UI filters the model list with ``capability in m.capabilities``;
new dialogs let the user check Chat / Image Gen / (Speech / Embedding
reserved). The image-generation tool refuses model_refs whose model row
lacks ``image_gen`` and returns an ADR-0021 envelope so the LLM can
self-correct.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "llm_models",
        sa.Column(
            "capabilities",
            sa.JSON(),
            nullable=False,
            server_default='["chat"]',
        ),
    )


def downgrade() -> None:
    op.drop_column("llm_models", "capabilities")
