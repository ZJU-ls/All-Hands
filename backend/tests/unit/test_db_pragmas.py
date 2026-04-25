"""E18 regression · every new SQLite connection must enable WAL +
busy_timeout=3000 on open.

Default SQLite (journal_mode=delete, busy_timeout=0) + Python sqlite3's
default 5 s driver timeout turned every EventBus publish during an SSE chat
turn into a 3-5 s stall, because the bus's persist session contends with the
request session for the single write lock. With WAL + explicit busy_timeout
the stall drops to <100 ms end-to-end (verified via curl + per-line wall
clock trace).

This file pins the pragma plumbing: if someone swaps the engine factory or
removes the ``connect`` listener, these tests red.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import create_async_engine

from allhands.persistence.db import _install_sqlite_pragmas


@pytest.mark.asyncio
async def test_new_connection_has_wal_mode(tmp_path: Path) -> None:
    url = f"sqlite+aiosqlite:///{tmp_path / 'x.db'}"
    engine = create_async_engine(url, future=True)
    _install_sqlite_pragmas(engine)
    try:
        async with engine.connect() as conn:
            row = await conn.exec_driver_sql("PRAGMA journal_mode")
            mode = row.scalar()
        assert str(mode).lower() == "wal"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_new_connection_has_busy_timeout_3000(tmp_path: Path) -> None:
    url = f"sqlite+aiosqlite:///{tmp_path / 'y.db'}"
    engine = create_async_engine(url, future=True)
    _install_sqlite_pragmas(engine)
    try:
        async with engine.connect() as conn:
            row = await conn.exec_driver_sql("PRAGMA busy_timeout")
            value = row.scalar()
        # Must be the 3 s we installed, not the 5 s Python sqlite3 default
        # or the 0 ms SQLite stock default.
        assert value == 3000
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_new_connection_has_synchronous_normal(tmp_path: Path) -> None:
    url = f"sqlite+aiosqlite:///{tmp_path / 'z.db'}"
    engine = create_async_engine(url, future=True)
    _install_sqlite_pragmas(engine)
    try:
        async with engine.connect() as conn:
            row = await conn.exec_driver_sql("PRAGMA synchronous")
            value = row.scalar()
        # synchronous=NORMAL (1) is the WAL-mode sweet spot (SQLite docs).
        # FULL (2) would fsync every commit; OFF (0) risks corruption.
        assert value == 1
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_new_connection_enables_foreign_keys(tmp_path: Path) -> None:
    """L15 regression · SQLite ignores declared ``ON DELETE CASCADE`` unless
    ``PRAGMA foreign_keys=ON`` is set per connection. Without this the UI
    and Lead Agent's view of providers/models diverge: deleting a provider
    leaves orphan rows in ``llm_models``, the ``list_models`` meta tool
    returns them, and Lead reports providers that no longer exist.
    """

    url = f"sqlite+aiosqlite:///{tmp_path / 'fk.db'}"
    engine = create_async_engine(url, future=True)
    _install_sqlite_pragmas(engine)
    try:
        async with engine.connect() as conn:
            row = await conn.exec_driver_sql("PRAGMA foreign_keys")
            value = row.scalar()
        assert value == 1, f"FK enforcement must be on; got {value!r}"
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_delete_provider_cascades_to_models(tmp_path: Path) -> None:
    """End-to-end: with FK pragma ON + the ORM's declared cascade, deleting
    a ``llm_providers`` row actually removes the children from
    ``llm_models``. If this test goes red the L15 bug is back — Lead will
    start reporting phantom providers again.
    """

    from allhands.persistence.orm.base import Base
    from allhands.persistence.orm.models import LLMModelRow, LLMProviderRow

    url = f"sqlite+aiosqlite:///{tmp_path / 'cascade.db'}"
    engine = create_async_engine(url, future=True)
    _install_sqlite_pragmas(engine)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        from sqlalchemy.ext.asyncio import async_sessionmaker

        Session = async_sessionmaker(bind=engine, expire_on_commit=False)
        async with Session() as s:
            s.add(
                LLMProviderRow(
                    id="p1",
                    name="TestProvider",
                    kind="openai",
                    base_url="http://x",
                    api_key="",
                    enabled=True,
                )
            )
            # Commit the parent before adding the child so FK resolution has
            # no dependency-order ambiguity — the bug we're pinning is cascade
            # on *delete*, not insert ordering.
            await s.commit()
        async with Session() as s:
            s.add(
                LLMModelRow(
                    id="m1",
                    provider_id="p1",
                    name="m1",
                    display_name="M1",
                    context_window=8192,
                    enabled=True,
                )
            )
            await s.commit()

        async with Session() as s:
            await s.execute(sa_text("DELETE FROM llm_providers WHERE id='p1'"))
            await s.commit()
            remaining = (await s.execute(sa_text("SELECT COUNT(*) FROM llm_models"))).scalar()
        assert remaining == 0, (
            "Expected the model to be cascaded away with its provider; "
            f"got {remaining} remaining. FK pragma or declared cascade broken."
        )
    finally:
        await engine.dispose()
