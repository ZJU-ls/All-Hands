"""Entrypoint. `uvicorn allhands.main:app` uses this module."""

from __future__ import annotations

from allhands.api import create_app

app = create_app()
