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
    "/api/auth/register",
    "/api/auth/passkey/",
    "/api/auth/magic-link/",
    "/api/auth/google/exchange",
    # Passkey and magic-link are first-class sign-in methods the demo exposes
    # on the login screen. Their flows are multi-step POSTs matched by prefix.
    # Omitting them made both methods 403 in demo mode while
    # password/Google/demo-login kept working.
    #
    # Passkey: only the authenticate/* sub-paths (options + verify) — i.e.
    # SIGN-IN. Registration (passkey/register/*) and add (passkey/add/*) stay
    # blocked so demo keeps its no-account-creation invariant, consistent with
    # password /api/auth/register also being absent here and the login UI
    # hiding sign-up in demo.
    # Magic-link: request + verify are both part of sign-in, so the whole
    # prefix is allowed.
    "/api/auth/passkey/authenticate/",
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
