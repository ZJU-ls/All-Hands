"""FastAPI app factory. All routers are registered here."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from allhands import __version__
from allhands.api.routers import health
from allhands.api.routers.chat import router as chat_router
from allhands.api.routers.confirmations import router as confirmations_router
from allhands.api.routers.employees import router as employees_router
from allhands.api.routers.models import router as models_router
from allhands.api.routers.providers import router as providers_router
from allhands.api.routers.skills import router as skills_router
from allhands.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="allhands",
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
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
    return app
