"""LangGraph checkpointer factory — ADR 0014 R1.

The checkpointer is a graph-internal state port. Only ``allhands.execution``
(this module + runner.py) is allowed to touch ``langgraph.checkpoint.*``;
the import-linter ``checkpointer-only-in-execution`` contract enforces that
services / api / core never reach for it. This module is the single entry
point that api/app.py's lifespan uses during startup — keeps the FastAPI
layer from holding a direct dependency on the checkpoint subpackage.

The return value is an async context manager (``AsyncSqliteSaver.from_conn_string``)
so the caller owns lifetime: ``__aenter__`` on app start, ``__aexit__`` on
shutdown. See ADR 0014 §3 Phase 1 for the full rationale.
"""

from __future__ import annotations

from typing import Any


def make_async_sqlite_checkpointer(db_path: str) -> Any:
    """Return an AsyncSqliteSaver async context manager for ``db_path``.

    The caller is responsible for ``__aenter__`` / ``__aexit__`` to
    control the saver's lifetime. Kept small on purpose: this is the only
    module that imports from ``langgraph.checkpoint.sqlite.aio``, so if
    LangGraph ever renames the module, there's exactly one place to update.
    """
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

    return AsyncSqliteSaver.from_conn_string(db_path)
