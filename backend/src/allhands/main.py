"""Application entry point. Runs Alembic migrations and seeds Lead Agent on startup.

Trigger scheduler + event listener come up via `api.app._lifespan`; this
startup hook only handles the one-shot bootstrap (migrations + Lead Agent).
We keep `on_event` rather than collapsing into the lifespan CM because the
bootstrap needs a running event loop but must not block scheduler start.
"""

from __future__ import annotations

import structlog

from allhands.api import create_app

log = structlog.get_logger()
app = create_app()


@app.on_event("startup")
async def startup() -> None:
    import subprocess

    from allhands.config import get_settings
    from allhands.persistence.db import get_sessionmaker
    from allhands.persistence.sql_repos import SqlEmployeeRepo
    from allhands.services.bootstrap_service import ensure_lead_agent

    settings = get_settings()
    settings.ensure_data_dir()

    # Run migrations via subprocess to avoid asyncio conflict
    try:
        result = subprocess.run(  # noqa: ASYNC221  # intentional blocking: avoids nested-loop error from alembic's asyncio.run()
            ["uv", "run", "alembic", "upgrade", "head"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0:
            log.info("alembic.upgrade", status="ok")
        else:
            log.warning("alembic.upgrade.failed", stderr=result.stderr[:200])
    except Exception as exc:
        log.warning("alembic.upgrade.failed", error=str(exc))

    # Seed Lead Agent
    try:
        maker = get_sessionmaker()
        async with maker() as session, session.begin():
            repo = SqlEmployeeRepo(session)
            lead = await ensure_lead_agent(repo)
            log.info("lead_agent.ready", id=lead.id, name=lead.name)
    except Exception as exc:
        log.warning("lead_agent.seed.failed", error=str(exc))
