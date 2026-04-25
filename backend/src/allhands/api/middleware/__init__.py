"""HTTP middleware shared across the FastAPI app."""

from allhands.api.middleware.locale import LocaleMiddleware

__all__ = ["LocaleMiddleware"]
