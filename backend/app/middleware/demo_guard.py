"""Middleware that makes the app read-only in demo mode.

Blocks POST/PUT/PATCH/DELETE except for auth exchanges and an explicit list of AI
mutation paths (LLM read/analyze flows). Mutations such as execute-action and
FSA item status updates are blocked in demo.
"""
from __future__ import annotations

import json

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


_DEMO_AUTH_PREFIXES = (
    "/api/auth/demo-login",
    "/api/auth/login",
    "/api/auth/google/exchange",
)

# Exact paths (not prefixes). Matching by prefix historically let future AI
# routes whose path starts with an existing one (e.g. "/api/ai/parse-action-v2")
# auto-allow mutations in demo without review. Exact match makes every new
# route an explicit decision.
_DEMO_AI_MUTATION_PATHS = frozenset({
    "/api/ai/chat/stream",
    "/api/ai/insights",
    "/api/ai/budget-insights",
    "/api/ai/budget-suggestions",
    "/api/ai/debt-plan-suggestion",
    "/api/ai/parse-action",
    "/api/ai/suggest-interest-rates",
    "/api/ai/fsa-review",
})

# Non-AI mutation paths allowed by product policy in demo. The demo's
# observe/diagnose/decide loop needs these: set a pay schedule, advance the
# cycle-review step, add/patch cycle commitments, dismiss a recurring
# suggestion. Dropping them accidentally broke the demo's guided tour.
#
# Exact paths stay exact; `cycle-commitments` uses prefix match because the
# resource has `/{id}` sub-routes (PATCH/DELETE).
_DEMO_NON_AI_MUTATION_PATHS = frozenset({
    "/api/settings/pay-schedule",
    "/api/settings/cycle-review",
    "/api/recurring/suggestions/dismiss",
})
_DEMO_NON_AI_MUTATION_PREFIXES = (
    "/api/cycle-commitments",
)


def is_demo_ai_mutation_allowed(path: str, method: str) -> bool:
    """Return True if this AI path may mutate in demo mode (POST/PUT/PATCH/DELETE).

    Uses exact-path matching: new AI mutation routes must be added explicitly.
    """
    return path in _DEMO_AI_MUTATION_PATHS


def is_demo_mutation_allowed(path: str, method: str) -> bool:
    """Return True if the demo allowlist permits this mutating request."""
    if any(path.startswith(p) for p in _DEMO_AUTH_PREFIXES):
        return True
    # LLM categorization suggest is read-only analysis (apply stays blocked below).
    if path == "/api/categorization/suggest" and method == "POST":
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
