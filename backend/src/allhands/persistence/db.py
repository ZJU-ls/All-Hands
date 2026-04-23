"""Async engine / sessionmaker factory. Created lazily from Settings.

**SQLite concurrency hardening (E18):** default SQLite is ``journal_mode=delete``
+ Python sqlite3 default ``timeout=5.0``. During an SSE chat turn the request
session holds a transaction open while the EventBus (``run.started`` /
``conversation.turn_completed`` / ``run.completed``) publishes from a *separate*
connection — classic single-writer contention. With default settings every
bus publish sits on the write lock for ~5 s before the driver gives up with
"database is locked". The user perceives it as **10 s of pointless delay per
chat turn** (once at turn start, once at turn end between last token and
RUN_FINISHED). Traced with ``curl`` + per-line wall clock + log greps.

Fix: on every new connection emit ``PRAGMA journal_mode=WAL`` (concurrent
readers + one writer) and ``PRAGMA busy_timeout=3000`` (3 s soft retry). WAL
keeps writes serialised but doesn't block readers, eliminating the per-turn
stalls. 3 s is defensive — still prompt failure if something is *really*
stuck, not a silent 10+ s hang.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from allhands.config import get_settings


@lru_cache(maxsize=1)
def get_engine() -> AsyncEngine:
    settings = get_settings()
    settings.ensure_data_dir()
    engine = create_async_engine(
        settings.database_url,
        echo=False,
        future=True,
    )
    if settings.database_url.startswith("sqlite"):
        _install_sqlite_pragmas(engine)
    return engine


def _install_sqlite_pragmas(engine: AsyncEngine) -> None:
    """Apply WAL + busy_timeout to every new DBAPI connection.

    Listens on ``connect`` (fires once per raw driver connection · before it
    ever gets used) so the pragmas ride every session without the services
    having to know. SQLAlchemy exposes the async engine's sync counterpart
    via ``engine.sync_engine`` — event listeners have to attach there.
    """

    @event.listens_for(engine.sync_engine, "connect")
    def _pragma_on_connect(dbapi_connection: Any, _: Any) -> None:
        cursor = dbapi_connection.cursor()
        try:
            # WAL: concurrent readers + one writer (vs default `delete`
            # where any read blocks writes and vice-versa).
            cursor.execute("PRAGMA journal_mode=WAL")
            # 3 s max lock wait. Default Python sqlite3 timeout is 5 s which
            # turns every EventBus publish during an SSE stream into a 5 s
            # stall — E18 diagnosis.
            cursor.execute("PRAGMA busy_timeout=3000")
            # synchronous=NORMAL is the right pair with WAL: fsync only at
            # checkpoint boundaries, still durable for committed transactions
            # (SQLite docs § "WAL mode").
            cursor.execute("PRAGMA synchronous=NORMAL")
            # SQLite ignores declared ``ON DELETE CASCADE`` / ``FOREIGN KEY``
            # constraints unless this pragma is flipped on per connection
            # (SQLite docs § "Enabling Foreign Key Support"). Without it,
            # deleting an ``llm_providers`` row leaves its models orphaned —
            # `list_models` then returns phantom `provider_id`s and Lead
            # Agent reports providers the user already wiped from the UI
            # (L15). This is one line of defence; the other is sweeping
            # existing orphans (Alembic revision 0019) so the page and the
            # agent stay in sync.
            cursor.execute("PRAGMA foreign_keys=ON")
        finally:
            cursor.close()


@lru_cache(maxsize=1)
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(
        bind=get_engine(),
        expire_on_commit=False,
        autoflush=False,
    )
