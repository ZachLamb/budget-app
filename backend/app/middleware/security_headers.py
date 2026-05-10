"""Security headers for FastAPI API responses.

The Next.js frontend already sets headers on every page request (see
``frontend/next.config.ts``). The backend serves API responses directly to
both same-origin browser fetches (via Next.js's rewrite proxy) and external
clients (curl, mobile apps), so we set the API-relevant subset here too:

- X-Content-Type-Options: nosniff — prevents browsers from sniffing JSON as HTML
- X-Frame-Options: DENY — JSON responses shouldn't be framed regardless
- Referrer-Policy: same-origin — don't leak API URLs in cross-origin referers
- Cache-Control: no-store on auth-bearing routes (set per-route, not here)

We deliberately do NOT set CSP/HSTS/Permissions-Policy on API responses —
those are page-level controls that belong to the front-end host. CORS is
handled by ``CORSMiddleware`` separately.
"""
from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        for k, v in _HEADERS.items():
            # Don't overwrite a route that intentionally set a stricter value.
            response.headers.setdefault(k, v)
        return response
