"""Sweep orphan llm_models rows whose provider_id no longer exists.

Revision ID: 0019
Revises: 0018
Create Date: 2026-04-22

Context (L15 / 2026-04-22):
  Up until this revision, deleting a row from ``llm_providers`` silently
  left its children in ``llm_models`` behind. The FK declares
  ``ON DELETE CASCADE``, but SQLite ignores that unless the per-connection
  ``PRAGMA foreign_keys=ON`` is set — which the app wasn't doing. As a
  result, ``list_models`` returned models referencing deleted providers,
  and Lead Agent reported "5 providers · 13 models" while the UI showed
  only 1 provider · 4 models. The two views diverged.

Fix has two halves:
  1. ``persistence/db.py`` now emits ``PRAGMA foreign_keys=ON`` on every
     new connection so future provider deletes cascade correctly.
  2. This migration wipes the orphans that built up while the pragma was
     missing, bringing every existing dev/prod DB back in sync with the
     UI. Upgrade is idempotent — running it twice is a no-op.

Downgrade is unavailable: we'd have to recreate provider rows we can't
reconstruct. If you need a downgrade, restore from backup.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # DELETE ... WHERE provider_id NOT IN (SELECT id FROM llm_providers).
    # We use a correlated subquery instead of a LEFT JOIN because SQLite
    # `DELETE ... JOIN` syntax isn't supported; the subquery form is.
    op.execute(
        sa.text(
            "DELETE FROM llm_models "
            "WHERE provider_id NOT IN (SELECT id FROM llm_providers)"
        )
    )


def downgrade() -> None:
    # Can't un-delete orphans — their parent providers are gone. Intentional
    # no-op; the upstream state was already broken.
    pass
