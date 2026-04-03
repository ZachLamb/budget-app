"""Middleware that makes the app read-only in demo mode.

Blocks POST/PUT/PATCH/DELETE except for allowlisted paths (login, Google code exchange, AI chat).
"""
from __future__ import annotations

import json

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


# Paths that are allowed to receive mutations even in demo mode
_ALLOWED_PREFIXES = (
    "/api/auth/demo-login",
    "/api/auth/login",
    "/api/auth/google/exchange",
    "/api/ai/",
    "/api/cycle-commitments",
    "/api/settings/cycle-review",
)


class DemoGuardMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            path = request.url.path
            if not any(path.startswith(prefix) for prefix in _ALLOWED_PREFIXES):
                return Response(
                    content=json.dumps({
                        "detail": "This is a read-only demo. Sign up for your own account to make changes!"
                    }),
                    status_code=403,
                    media_type="application/json",
                )
        return await call_next(request)
