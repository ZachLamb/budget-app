"""Simple in-memory rate limiting (per server process). Complement with edge proxy limits in production."""
from __future__ import annotations

import json
import time
from collections import defaultdict, deque
from typing import Deque, Dict, List, Tuple

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

# (path prefix, max_hits, window_seconds)
# AI routes have a tight per-IP cap: each POST can hold a worker for up to the
# full Ollama read timeout (120s), so 120/min left a large cost-amplification /
# CPU-DoS window. 20/min is well above normal interactive use and keeps that
# door closed.
_RULES: List[Tuple[str, int, int]] = [
    ("/api/auth/login", 30, 60),
    ("/api/auth/demo-login", 20, 60),
    ("/api/auth/register", 10, 60),
    ("/api/auth/google/exchange", 30, 60),
    ("/api/auth/passkey/", 80, 60),
    ("/api/ai/", 20, 60),
]

_MAX_TRACKED_KEYS = 50_000


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip() or "unknown"
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """429 when a client exceeds per-route sliding-window limits."""

    def __init__(self, app):
        super().__init__(app)
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)

    def _prune(self, key: str, window: float, now: float) -> None:
        dq = self._hits[key]
        while dq and dq[0] < now - window:
            dq.popleft()
        if not dq:
            del self._hits[key]

    def _over_limit(self, key: str, max_hits: int, window: int) -> bool:
        if len(self._hits) > _MAX_TRACKED_KEYS and key not in self._hits:
            return False
        now = time.monotonic()
        window_f = float(window)
        self._prune(key, window_f, now)
        dq = self._hits[key]
        if len(dq) >= max_hits:
            return True
        dq.append(now)
        return False

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        method = request.method.upper()
        if method not in ("POST", "PUT", "PATCH", "DELETE"):
            return await call_next(request)

        for prefix, max_hits, window in _RULES:
            if path.startswith(prefix):
                ip = _client_ip(request)
                key = f"{prefix}:{ip}"
                if self._over_limit(key, max_hits, window):
                    return Response(
                        content=json.dumps({"detail": "Too many requests. Try again shortly."}),
                        status_code=429,
                        media_type="application/json",
                        headers={"Retry-After": str(window)},
                    )
                break

        return await call_next(request)
