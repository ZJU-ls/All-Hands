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


def _should_seed_demo() -> bool:
    """Demo data (providers / models / employees / conversations / events /
    MCP) is OPT-IN only · enabled by ``ALLHANDS_SEED_DEMO=1``.

    Cold-start contract (2026-04-27): a fresh clone gets exactly:
      - alembic migrations applied
      - Lead Agent created (entry point · always required)
      - builtin skills loaded from disk into SkillRegistry (lazy memoize)

    Everything else — providers / models / other employees / conversations
    / events — is built by the user via UI (/gateway, Lead chat). Previously
    `env in ("dev", "test")` defaulted demo seeds on for local dev,
    surprising new contributors with a pre-populated workspace they didn't
    create. Set ``ALLHANDS_SEED_DEMO=1`` to restore the "full house" view.

    The legacy ``ALLHANDS_SEED=1`` env var is also honoured for backwards
    compat (CI scripts may set it); both names mean the same thing now.
    """
    import os

    return os.environ.get("ALLHANDS_SEED_DEMO") == "1" or os.environ.get("ALLHANDS_SEED") == "1"


@app.on_event("startup")
async def startup() -> None:
    import subprocess

    from allhands.config import get_settings
    from allhands.persistence.db import get_sessionmaker
    from allhands.persistence.sql_repos import SqlEmployeeRepo
    from allhands.services import seed_service
    from allhands.services.bootstrap_service import ensure_expert_programmer, ensure_lead_agent

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

    # Seed Lead Agent + ExpertProgrammer
    try:
        maker = get_sessionmaker()
        async with maker() as session, session.begin():
            repo = SqlEmployeeRepo(session)
            lead = await ensure_lead_agent(repo)
            log.info("lead_agent.ready", id=lead.id, name=lead.name)
            programmer = await ensure_expert_programmer(repo)
            log.info("expert_programmer.ready", id=programmer.id, name=programmer.name)
    except Exception as exc:
        log.warning("employee.seed.failed", error=str(exc))

    # Tool-id rename migrations · sweep every employee (not just Lead) so
    # custom-built employees that still reference plan_create / plan_view
    # / etc. heal automatically. Idempotent — no-op when nothing's stale.
    try:
        from allhands.services.tool_id_migrations import migrate_all_employee_tool_ids

        maker = get_sessionmaker()
        async with maker() as session, session.begin():
            count = await migrate_all_employee_tool_ids(SqlEmployeeRepo(session))
            if count:
                log.info("tool_ids.migrate.swept", touched=count)
    except Exception as exc:
        log.warning("tool_ids.migrate.failed", error=str(exc))

    # Auto-detect vision capability for already-registered models that pre-date
    # the supports_images column (default 0). Users get sensible defaults
    # without having to manually flip a switch for every claude / gpt-4o /
    # qwen-vl model already in their workspace.
    try:
        from allhands.persistence.sql_repos import SqlLLMModelRepo
        from allhands.services.vision_capability import infer_supports_images

        maker = get_sessionmaker()
        async with maker() as session:
            repo_m = SqlLLMModelRepo(session)
            models = await repo_m.list_all()
            updated = 0
            for m in models:
                inferred = infer_supports_images(m.name)
                if inferred and not m.supports_images:
                    await repo_m.upsert(m.model_copy(update={"supports_images": True}))
                    updated += 1
            if updated:
                log.info("models.vision_backfill", updated=updated, total=len(models))
    except Exception as exc:
        log.warning("models.vision_backfill.failed", error=str(exc))

    # 2026-04-26 P3 · drawio-creator skill was merged into allhands.artifacts.
    # Sanity scan: any stale 'allhands.drawio-creator' reference in the DB
    # would resolve to "skill not found" and break activation. The 0029
    # alembic migration rewrites these to allhands.artifacts; this scan is
    # the second line of defence — log loudly if anything slipped through so
    # ops can re-run the migration. Scan is best-effort (non-fatal).
    try:
        from allhands.services.bootstrap_service import (
            scan_for_dropped_skill_references,
        )

        maker = get_sessionmaker()
        async with maker() as session:
            stale = await scan_for_dropped_skill_references(
                session, dropped_id="allhands.drawio-creator"
            )
        if stale:
            log.warning(
                "drawio_creator.stale_refs",
                count=stale,
                hint=(
                    "run `uv run alembic upgrade head` then restart · old skill "
                    "id 'allhands.drawio-creator' should have been replaced with "
                    "'allhands.artifacts'"
                ),
            )
        else:
            log.info("drawio_creator.migrated", status="ok")
    except Exception as exc:
        log.warning("drawio_creator.scan.failed", error=str(exc))

    # Demo data · OPT-IN. A pristine clone starts with only Lead Agent +
    # builtin skills (above); providers / models / other employees /
    # conversations / events are user-built via /gateway + Lead chat. Set
    # ALLHANDS_SEED_DEMO=1 (or legacy ALLHANDS_SEED=1) to load the dev
    # "full house" view used by demos and screenshot tests.
    if _should_seed_demo():
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
