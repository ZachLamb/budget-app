"""Per-path, per-IP rate limiting middleware.

Backed by a pluggable store (in-memory for dev, Upstash Redis over HTTP for
deployments that need shared buckets across workers/replicas). Pick by
setting ``UPSTASH_REDIS_REST_URL`` + ``UPSTASH_REDIS_REST_TOKEN``.

X-Forwarded-For is only trusted when the immediate peer is in the
``TRUSTED_PROXIES`` allowlist. This prevents arbitrary clients from
spoofing their IP to sidestep the per-IP cap (or to DoS a single shared
bucket by setting ``X-Forwarded-For: unknown``).
"""
from __future__ import annotations

import ipaddress
import json
from typing import List, Optional, Tuple

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.config import get_settings
from app.middleware.rate_limit_store import RateLimitStore, build_store

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
    ("/api/auth/native/token", 10, 60),
    ("/api/auth/passkey/", 80, 60),
    # On-device era: facts + FSA candidate routes only (no server LLM).
    ("/api/ai/", 20, 60),
    ("/api/ai/facts/", 30, 60),
    # Opt-in cloud generate holds a worker for up to 120s — same cap as /api/ai/.
    ("/api/llm/cloud", 20, 60),
    # Magic-link request — cap per IP to limit abusive email spam against
    # known account holders. The anti-enumeration design means we treat
    # known and unknown emails identically, so this cap protects both.
    # 5/min per IP × scale-to-zero machine + Upstash shared bucket = at
    # most ~5 emails/min from any single IP no matter how many replicas.
    ("/api/auth/magic-link/request", 5, 60),
    # Magic-link verify — the token is single-use and 256-bit random, so
    # brute-forcing is infeasible. The IP cap is here only to slow down
    # blunt scanners. 30/min is generous.
    ("/api/auth/magic-link/verify", 30, 60),
]


def _parse_trusted_proxies(raw: str) -> List[ipaddress._BaseNetwork]:
    """Parse a comma-separated IP/CIDR list into network objects."""
    nets: List[ipaddress._BaseNetwork] = []
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        try:
            nets.append(ipaddress.ip_network(entry, strict=False))
        except ValueError:
            # Malformed entries silently drop — better than crashing startup;
            # operator sees the behavior in access logs.
            continue
    return nets


def _peer_in_trusted(peer: Optional[str], trusted: List[ipaddress._BaseNetwork]) -> bool:
    if not peer or not trusted:
        return False
    try:
        ip = ipaddress.ip_address(peer)
    except ValueError:
        return False
    return any(ip in net for net in trusted)


def client_ip_for_limit(request: Request, trusted: List[ipaddress._BaseNetwork]) -> str:
    """Pick the client IP for rate-limit bucketing.

    - If the peer is in the trusted-proxy list, honor the first ``X-Forwarded-For``.
    - Otherwise ignore XFF and use the direct peer address.
    - Fall back to ``"unknown"`` only as a last resort — buckets under that
      key are shared, so this should be rare.
    """
    peer = request.client.host if request.client else None
    if _peer_in_trusted(peer, trusted):
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            candidate = forwarded.split(",")[0].strip()
            if candidate:
                return candidate
    return peer or "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """429 when a client exceeds per-route sliding-window limits."""

    def __init__(
        self,
        app,
        *,
        store: Optional[RateLimitStore] = None,
        trusted_proxies: Optional[str] = None,
    ) -> None:
        super().__init__(app)
        settings = get_settings()
        self._store = store or build_store(
            rest_url=settings.upstash_redis_rest_url,
            rest_token=settings.upstash_redis_rest_token,
        )
        raw = settings.trusted_proxies if trusted_proxies is None else trusted_proxies
        self._trusted_proxies = _parse_trusted_proxies(raw)

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        method = request.method.upper()
        if method not in ("POST", "PUT", "PATCH", "DELETE"):
            return await call_next(request)

        for prefix, max_hits, window in _RULES:
            if path.startswith(prefix):
                ip = client_ip_for_limit(request, self._trusted_proxies)
                key = f"rl:{prefix}:{ip}"
                settings = get_settings()
                fail_open = not (
                    settings.auth_rate_limit_strict and prefix.startswith("/api/auth/")
                )
                result = await self._store.check_and_increment(
                    key, max_hits, window, fail_open=fail_open
                )
                # RFC 9331 draft: expose remaining budget on every response
                # under a matched rule so clients can back off before the
                # 429 instead of blindly retrying.
                remaining = max(0, max_hits - result.count)
                rate_headers = {
                    "RateLimit-Limit": str(max_hits),
                    "RateLimit-Remaining": str(remaining),
                    "RateLimit-Reset": str(window),
                }
                if result.over:
                    return Response(
                        content=json.dumps({"detail": "Too many requests. Try again shortly."}),
                        status_code=429,
                        media_type="application/json",
                        headers={"Retry-After": str(window), **rate_headers},
                    )
                response = await call_next(request)
                for name, value in rate_headers.items():
                    response.headers[name] = value
                return response

        return await call_next(request)
