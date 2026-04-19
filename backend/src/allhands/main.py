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


def _should_seed(env: str) -> bool:
    """I-0020: auto-seed only in dev/test or when ALLHANDS_SEED=1.

    Prod operators who explicitly opt in (e.g. first-run of a staging env)
    can flip the flag without changing code.
    """
    import os

    if env in ("dev", "test"):
        return True
    return os.environ.get("ALLHANDS_SEED") == "1"


@app.on_event("startup")
async def startup() -> None:
    import subprocess

    from allhands.config import get_settings
    from allhands.persistence.db import get_sessionmaker
    from allhands.persistence.sql_repos import SqlEmployeeRepo
    from allhands.services import seed_service
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

    # Dev / test seed: ensure every page has real "full house" data on cold start
    # (I-0020). No-op in prod unless ALLHANDS_SEED=1. Track N's seed_service
    # supersedes Track K's bootstrap_service.ensure_gateway_demo_seeds — the
    # latter is retained as a util but no longer wired into startup.
    if _should_seed(settings.env):
        try:
            maker = get_sessionmaker()
            async with maker() as session, session.begin():
                report = await seed_service.ensure_all_dev_seeds(session)
            log.info(
                "seed.dev.ready",
                providers=report.providers,
                models=report.models,
                employees=report.employees,
                mcp_servers=report.mcp_servers,
                conversations=report.conversations,
                events=report.events,
            )
        except Exception as exc:
            log.warning("seed.dev.failed", error=str(exc))
