"""Per-request locale middleware.

Order: explicit ``allhands_locale`` cookie → ``Accept-Language`` header →
:data:`allhands.i18n.DEFAULT_LOCALE`. The chosen locale is parked in a
``ContextVar`` for the request scope so anything calling
:func:`allhands.i18n.t` (handlers, services, formatters) gets the right
string without threading a parameter through every signature.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING

from starlette.middleware.base import BaseHTTPMiddleware

if TYPE_CHECKING:
    from starlette.requests import Request
    from starlette.responses import Response

from allhands.i18n import (
    LOCALE_COOKIE,
    is_locale,
    negotiate_locale,
    reset_current_locale,
    set_current_locale,
)


class LocaleMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        cookie_value = request.cookies.get(LOCALE_COOKIE)
        if is_locale(cookie_value):
            locale = cookie_value or ""
        else:
            locale = negotiate_locale(request.headers.get("accept-language"))

        token = set_current_locale(locale)
        try:
            response = await call_next(request)
        finally:
            reset_current_locale(token)
        # Echo the negotiated locale so clients can sanity-check what the
        # backend actually used (matches Vary: Accept-Language semantics).
        response.headers["content-language"] = locale
        return response
