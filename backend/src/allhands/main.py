"""Application entry point. Runs Alembic migrations and seeds Lead Agent on startup."""

from __future__ import annotations

import structlog

from allhands.api import create_app

log = structlog.get_logger()
app = create_app()


@app.on_event("startup")
async def startup() -> None:
    from alembic.config import Config as AlembicConfig

    from alembic import command
    from allhands.config import get_settings
    from allhands.persistence.db import get_sessionmaker
    from allhands.persistence.sql_repos import SqlEmployeeRepo
    from allhands.services.bootstrap_service import ensure_lead_agent

    settings = get_settings()
    if hasattr(settings, "ensure_data_dir"):
        settings.ensure_data_dir()

    # Run migrations
    try:
        cfg = AlembicConfig("alembic.ini")
        cfg.set_main_option(
            "sqlalchemy.url",
            settings.sync_database_url()
            if hasattr(settings, "sync_database_url")
            else str(settings.database_url).replace("sqlite+aiosqlite", "sqlite"),
        )
        command.upgrade(cfg, "head")
        log.info("alembic.upgrade", status="ok")
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
