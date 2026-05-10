"""Origin/Referer check on cookie-authenticated state-changing requests.

SameSite=Strict on the session cookie is the primary CSRF mitigation —
the browser refuses to send the cookie on cross-site requests in the first
place. This middleware is defense in depth: when the request DOES carry
the session cookie AND the method is state-changing (POST/PUT/PATCH/DELETE),
we additionally check that the Origin (or Referer fallback) matches an
allowed value derived from CORS_ORIGINS.

Header-only Bearer requests (curl, mobile, server-to-server) bypass the
check — they don't auto-send credentials so they aren't vulnerable to
the CSRF threat this middleware mitigates.

Why both? CLAUDE.md security checklist requires "SameSite=Lax/Strict +
explicit origin/referer check" for any cookie-authenticated state-changing
route. Browsers are evolving SameSite semantics; the explicit check is the
load-bearing control if a future browser ever weakens SameSite=Strict.
"""
from __future__ import annotations

import logging
from urllib.parse import urlparse
from typing import Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.config import get_settings
from app.services.auth.session_cookie import COOKIE_NAME

logger = logging.getLogger(__name__)


_STATE_CHANGING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def _origin_of(url: str) -> Optional[str]:
    """Return the ``scheme://host[:port]`` of a URL, or None on parse failure."""
    try:
        u = urlparse(url)
    except Exception:
        return None
    if not u.scheme or not u.netloc:
        return None
    return f"{u.scheme}://{u.netloc}"


class OriginCheckMiddleware(BaseHTTPMiddleware):
    """Reject state-changing cookie-authenticated requests from disallowed origins.

    The allowlist comes from ``CORS_ORIGINS`` settings (already an explicit
    list — wildcards are forbidden by ``get_settings``).
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.method not in _STATE_CHANGING_METHODS:
            return await call_next(request)
        # Only enforce when the cookie is in play. Header-only requests are
        # not vulnerable to CSRF in the way this defends against.
        if COOKIE_NAME not in request.cookies:
            return await call_next(request)

        origin_header = request.headers.get("origin")
        referer_header = request.headers.get("referer")
        candidate = origin_header or (_origin_of(referer_header) if referer_header else None)

        settings = get_settings()
        allowed = {o.strip().rstrip("/") for o in settings.cors_origins.split(",") if o.strip()}
        if candidate is not None and candidate.rstrip("/") in allowed:
            return await call_next(request)

        # Browsers attach Origin to all CORS requests and to most same-origin
        # state-changing requests in modern engines. A missing Origin AND
        # missing Referer on a cookie-authenticated POST is suspicious enough
        # to refuse — fail closed.
        logger.warning(
            "origin_check_rejected method=%s path=%s origin=%r referer=%r",
            request.method,
            request.url.path,
            origin_header,
            referer_header,
        )
        return JSONResponse(
            status_code=403,
            content={"detail": "Cross-origin request rejected"},
        )
