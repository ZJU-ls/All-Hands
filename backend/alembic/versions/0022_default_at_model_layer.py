"""Move "default" from LLMProvider (two-field state) to LLMModel (singleton).

Revision ID: 0022
Revises: 0021
Create Date: 2026-04-25

第一性原理重构 (2026-04-25):
Pre-this-revision the schema represented "the workspace default" as TWO
fields on ``llm_providers`` — ``is_default: bool`` (which provider) and
``default_model: str`` (which model on it). The pair could desync —
typing a model name string that didn't actually exist as an enabled
``llm_models`` row produced silent broken state at chat time. Worse, the
provider create form forced the user to commit to a default-model name
before any models had been registered.

This migration collapses the two fields into a SINGLE singleton flag on
``llm_models``: ``is_default: bool``. At most one row across the whole
table has ``is_default=True``. Both properties of "the workspace default"
— which provider, which model — are derived from that single row.

Backfill rule:
  For each provider row with the legacy ``is_default=True``, find the
  ``llm_models`` row where ``provider_id == that.id`` AND
  ``name == that.default_model``. If a match exists → mark it default.
  If no match (the legacy state was already broken) → fall back to the
  first registered model under that provider, if any. Otherwise no model
  is marked default and the system falls through to its "first enabled
  model" heuristic at runtime.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add the new column (default False, not null).
    with op.batch_alter_table("llm_models") as batch:
        batch.add_column(
            sa.Column(
                "is_default",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        batch.create_index("ix_llm_models_is_default", ["is_default"])

    # 2. Backfill from the legacy two-field state. Pure SQL — no model
    #    layer involvement, so this stays portable across SQLite + Postgres.
    bind = op.get_bind()
    legacy_default_provider = bind.execute(
        sa.text(
            "SELECT id, default_model FROM llm_providers WHERE is_default = 1"
        )
    ).mappings().first()
    if legacy_default_provider:
        pid = legacy_default_provider["id"]
        legacy_name = legacy_default_provider["default_model"] or ""
        # Try exact name match first.
        match = bind.execute(
            sa.text(
                "SELECT id FROM llm_models "
                "WHERE provider_id = :pid AND name = :name AND enabled = 1 "
                "LIMIT 1"
            ),
            {"pid": pid, "name": legacy_name},
        ).scalar_one_or_none()
        if match is None:
            # Fallback: first enabled model under the legacy default provider.
            match = bind.execute(
                sa.text(
                    "SELECT id FROM llm_models "
                    "WHERE provider_id = :pid AND enabled = 1 "
                    "ORDER BY name LIMIT 1"
                ),
                {"pid": pid},
            ).scalar_one_or_none()
        if match is not None:
            bind.execute(
                sa.text("UPDATE llm_models SET is_default = 1 WHERE id = :id"),
                {"id": match},
            )

    # 3. Drop the legacy fields. SQLite needs batch_alter_table to do this
    #    safely (it rebuilds the table).
    with op.batch_alter_table("llm_providers") as batch:
        batch.drop_column("default_model")
        batch.drop_column("is_default")


def downgrade() -> None:
    # Re-add the legacy fields with their original defaults.
    with op.batch_alter_table("llm_providers") as batch:
        batch.add_column(
            sa.Column(
                "default_model",
                sa.String(length=128),
                nullable=False,
                server_default="gpt-4o-mini",
            )
        )
        batch.add_column(
            sa.Column(
                "is_default",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )

    # Best-effort backfill back to the old shape: find the unique default
    # model row, set its provider's ``is_default=True`` and ``default_model``
    # to the model's name. Lossy if multiple models had been default
    # (shouldn't happen — singleton invariant — but be defensive).
    bind = op.get_bind()
    default_model = bind.execute(
        sa.text(
            "SELECT provider_id, name FROM llm_models WHERE is_default = 1 LIMIT 1"
        )
    ).mappings().first()
    if default_model:
        bind.execute(
            sa.text(
                "UPDATE llm_providers SET is_default = 1, default_model = :name "
                "WHERE id = :pid"
            ),
            {"pid": default_model["provider_id"], "name": default_model["name"]},
        )

    with op.batch_alter_table("llm_models") as batch:
        batch.drop_index("ix_llm_models_is_default")
        batch.drop_column("is_default")
