"""API layer (L7). FastAPI routers + SSE transport. Depends on services/ and core/ only."""

from allhands.api.app import create_app

__all__ = ["create_app"]
