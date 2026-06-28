"""Demo guard: auth + explicit AI mutation allowlist + non-AI product-policy paths."""

from __future__ import annotations

import json

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


_DEMO_AUTH_PREFIXES = (
    "/api/auth/demo-login",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/google/exchange",
    # Passkey sign-in only (options + verify). Registration and add-passkey
    # stay blocked so demo keeps its no-account-creation invariant.
    "/api/auth/passkey/authenticate/",
    # Magic-link request + verify are both part of sign-in.
    "/api/auth/magic-link/",
)

# Cloud model routes were removed — on-device AI needs no demo mutation allowlist.
_DEMO_AI_MUTATION_PATHS = frozenset()

_DEMO_NON_AI_MUTATION_PATHS = frozenset({
    "/api/settings/pay-schedule",
    "/api/settings/cycle-review",
    "/api/recurring/suggestions/dismiss",
})
_DEMO_NON_AI_MUTATION_PREFIXES = (
    "/api/cycle-commitments",
)


def is_demo_ai_mutation_allowed(path: str, method: str) -> bool:
    return path in _DEMO_AI_MUTATION_PATHS


def is_demo_mutation_allowed(path: str, method: str) -> bool:
    if any(path.startswith(p) for p in _DEMO_AUTH_PREFIXES):
        return True
    if path in _DEMO_NON_AI_MUTATION_PATHS:
        return True
    if any(path.startswith(p) for p in _DEMO_NON_AI_MUTATION_PREFIXES):
        return True
    return is_demo_ai_mutation_allowed(path, method)


class DemoGuardMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            path = request.url.path
            if not is_demo_mutation_allowed(path, request.method):
                return Response(
                    content=json.dumps({
                        "detail": (
                            "This is a read-only demo. Changes are disabled. "
                            "Run your own copy locally to try the full app."
                        )
                    }),
                    status_code=403,
                    media_type="application/json",
                )
        return await call_next(request)
