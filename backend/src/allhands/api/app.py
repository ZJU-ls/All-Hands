"""FastAPI app factory. All routers are registered here."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from allhands import __version__
from allhands.api.routers import health
from allhands.api.routers.artifacts import router as artifacts_router
from allhands.api.routers.channels import (  # single-line register: Wave 2 notification-channels
    notifications_router,
)
from allhands.api.routers.channels import (
    router as channels_router,
)
from allhands.api.routers.chat import router as chat_router
from allhands.api.routers.cockpit import router as cockpit_router
from allhands.api.routers.confirmations import router as confirmations_router
from allhands.api.routers.employees import router as employees_router
from allhands.api.routers.market import (
    router as market_router,  # single-line register: Wave 2 market-data
)
from allhands.api.routers.mcp_servers import router as mcp_servers_router
from allhands.api.routers.models import router as models_router
from allhands.api.routers.observatory import router as observatory_router
from allhands.api.routers.plans import router as plans_router
from allhands.api.routers.providers import router as providers_router
from allhands.api.routers.skills import router as skills_router
from allhands.api.routers.tasks import router as tasks_router
from allhands.api.routers.triggers import router as triggers_router
from allhands.api.routers.webhooks import router as webhooks_router
from allhands.config import get_settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Own the TriggerRuntime + optional LangGraph checkpointer for the process lifetime.

    Kept compact so test clients that want to bypass scheduler (TestClient
    with dependency_overrides) can skip the runtime: they just never touch
    `app.state.trigger_runtime` and the routers that need it return 503.
    Same for `app.state.checkpointer` — None is the default (ADR 0014 Phase 1).
    """
    from allhands.api.deps import get_tool_registry
    from allhands.execution.triggers.runtime import TriggerRuntime
    from allhands.persistence.db import get_sessionmaker

    runtime: TriggerRuntime | None = None
    try:
        maker = get_sessionmaker()
        runtime = TriggerRuntime(
            session_maker=maker,
            tool_registry=get_tool_registry(),
        )
        await runtime.start()
        app.state.trigger_runtime = runtime
    except Exception:
        logger.exception("trigger.runtime.start.failed")
        app.state.trigger_runtime = None

    # Register installed skills (market / github / upload) into the shared
    # SkillRegistry. Without this, `employee.skill_ids` referencing installed
    # skills resolve to None at runtime and the agent's system prompt silently
    # drops them (ADR 0015 live-smoke regression). Built-in skills go through
    # `seed_skills()` on first `get_skill_registry()` call; this loads the
    # second leg from the DB. Exceptions are logged — we never block startup
    # over skill-registry load failure (chat still works with built-ins).
    try:
        from allhands.api.deps import get_skill_registry
        from allhands.execution.skills import load_installed_skills
        from allhands.persistence.sql_repos import SqlSkillRepo

        maker = get_sessionmaker()
        registry = get_skill_registry()
        async with maker() as session, session.begin():
            count = await load_installed_skills(registry, SqlSkillRepo(session))
        logger.info("installed_skills.loaded count=%d", count)
    except Exception:
        logger.exception("installed_skills.load.failed")

    # ADR 0017 · one-time replay of legacy conversations into the event
    # log. A conversation that existed before this refactor has messages
    # rows but no events; without this replay, build_llm_context returns
    # empty messages and the LLM forgets earlier context. Idempotent —
    # re-runs skip conversations that already have events.
    try:
        from allhands.persistence.sql_repos import (
            SqlConversationEventRepo,
            SqlConversationRepo,
        )
        from allhands.services.legacy_event_migration import (
            replay_all_legacy_conversations,
        )

        maker = get_sessionmaker()
        async with maker() as session, session.begin():
            convs, events = await replay_all_legacy_conversations(
                conversation_repo=SqlConversationRepo(session),
                event_repo=SqlConversationEventRepo(session),
            )
        logger.info(
            "legacy_migration.done conversations=%d events=%d",
            convs,
            events,
        )
    except Exception:
        logger.exception("legacy_migration.failed")

    # ADR 0017 · P2.A — crash-recovery scan. Any TURN_STARTED without a
    # matching TURN_COMPLETED / TURN_ABORTED is orphaned (process killed
    # mid-turn, OOM, etc). Close each with reason=crash_recovery so the
    # next build_llm_context can synthesize a coherent assistant message
    # rather than leaving the LLM with two back-to-back user turns.
    try:
        from allhands.persistence.sql_repos import (
            SqlConversationEventRepo,
            SqlConversationRepo,
        )
        from allhands.services.turn_lock import scan_and_close_orphan_turns

        maker = get_sessionmaker()
        async with maker() as session, session.begin():
            closed = await scan_and_close_orphan_turns(
                event_repo=SqlConversationEventRepo(session),
                conversation_repo=SqlConversationRepo(session),
            )
        logger.info("turn_lock.orphan_scan.done closed=%d", closed)
    except Exception:
        logger.exception("turn_lock.orphan_scan.failed")

    # ADR 0018: checkpointer removed. State lives in MessageRepo +
    # ConfirmationRepo + SkillRuntimeRepo. Suspend / resume flows
    # through DeferredSignal polling, not graph-level snapshots.
    app.state.checkpointer = None

    try:
        yield
    finally:
        if runtime is not None:
            try:
                await runtime.shutdown()
            except Exception:
                logger.exception("trigger.runtime.shutdown.failed")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="allhands",
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=_lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router, prefix="/api")
    app.include_router(chat_router, prefix="/api")
    app.include_router(confirmations_router, prefix="/api")
    app.include_router(employees_router, prefix="/api")
    app.include_router(providers_router, prefix="/api")
    app.include_router(models_router, prefix="/api")
    app.include_router(skills_router, prefix="/api")
    app.include_router(mcp_servers_router, prefix="/api")
    app.include_router(plans_router, prefix="/api")
    app.include_router(triggers_router, prefix="/api")
    app.include_router(webhooks_router, prefix="/api")
    app.include_router(artifacts_router, prefix="/api")
    app.include_router(cockpit_router, prefix="/api")
    app.include_router(tasks_router, prefix="/api")
    app.include_router(
        channels_router, prefix="/api"
    )  # single-line register: Wave 2 notification-channels
    app.include_router(
        notifications_router, prefix="/api"
    )  # single-line register: Wave 2 notification-channels
    app.include_router(market_router, prefix="/api")  # single-line register: Wave 2 market-data
    app.include_router(observatory_router, prefix="/api")
    return app
