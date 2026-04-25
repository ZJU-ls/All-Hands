"""Truly drop the residual FK on ``confirmations.tool_call_id``.

0024 claimed to do this via ``batch_alter_table`` + ``alter_column`` but
that's a no-op — alembic batch reflects the existing FK from sqlite_master
and re-emits it. Result: prod DBs upgraded through 0024 still carry the
``REFERENCES tool_calls (id)`` clause and every chat turn that needs a
confirmation hits ``IntegrityError: FOREIGN KEY constraint failed`` because
``tool_calls`` was emptied by the ADR 0018 move-to-JSON refactor.

Approach: rebuild ``confirmations`` from raw SQL on SQLite (the only
deployment target right now — see ADR 0018). Idempotent: if the FK was
never present, the rebuild lands an identical schema and is harmless.
"""

from __future__ import annotations

from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


_REBUILD_CONFIRMATIONS = """
CREATE TABLE confirmations__new (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    tool_call_id VARCHAR(64) NOT NULL,
    rationale VARCHAR(4000) NOT NULL,
    summary VARCHAR(4000) NOT NULL,
    diff JSON,
    status VARCHAR(32) NOT NULL,
    created_at DATETIME NOT NULL,
    resolved_at DATETIME,
    expires_at DATETIME NOT NULL,
    UNIQUE (tool_call_id)
);
INSERT INTO confirmations__new (
    id, tool_call_id, rationale, summary, diff, status,
    created_at, resolved_at, expires_at
)
SELECT id, tool_call_id, rationale, summary, diff, status,
       created_at, resolved_at, expires_at
FROM confirmations;
DROP TABLE confirmations;
ALTER TABLE confirmations__new RENAME TO confirmations;
CREATE INDEX ix_confirmations_tool_call_id ON confirmations(tool_call_id);
CREATE INDEX ix_confirmations_status ON confirmations(status);
CREATE INDEX ix_confirmations_created_at ON confirmations(created_at);
CREATE INDEX ix_confirmations_expires_at ON confirmations(expires_at);
"""


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        # Other dialects (postgres / mysql) would use a normal
        # ``DROP CONSTRAINT`` here; we don't ship for them yet, so
        # skipping is safe — the ORM also lost the ForeignKey wrapper
        # in this same change.
        return
    # Manual statement-by-statement so SQLAlchemy doesn't choke on the
    # multi-statement string.
    for stmt in _REBUILD_CONFIRMATIONS.strip().split(";\n"):
        stmt = stmt.strip()
        if stmt:
            op.execute(stmt)


def downgrade() -> None:
    # No-op: re-introducing the broken FK would just bring back the
    # original IntegrityError. The ``confirmations`` rows are unchanged.
    pass
