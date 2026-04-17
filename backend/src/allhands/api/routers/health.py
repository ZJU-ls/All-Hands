"""Liveness + version endpoint. Cheap — never touches DB / LLM."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from allhands import __version__

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: str
    version: str


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", version=__version__)
