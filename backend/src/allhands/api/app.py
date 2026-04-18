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
from allhands.api.routers.chat import router as chat_router
from allhands.api.routers.cockpit import router as cockpit_router
from allhands.api.routers.confirmations import router as confirmations_router
from allhands.api.routers.employees import router as employees_router
from allhands.api.routers.mcp_servers import router as mcp_servers_router
from allhands.api.routers.models import router as models_router
from allhands.api.routers.plans import router as plans_router
from allhands.api.routers.providers import router as providers_router
from allhands.api.routers.skills import router as skills_router
from allhands.api.routers.triggers import router as triggers_router
from allhands.api.routers.webhooks import router as webhooks_router
from allhands.config import get_settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Own the TriggerRuntime for the process lifetime.

    Kept compact so test clients that want to bypass scheduler (TestClient
    with dependency_overrides) can skip the runtime: they just never touch
    `app.state.trigger_runtime` and the routers that need it return 503.
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
    return app
