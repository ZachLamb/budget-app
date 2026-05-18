"""Per-email rate limit for magic-link request (anti-spam).

Counts attempts per normalized email in a fixed window. Unknown emails
are counted too so probing cannot bypass the cap by using fake addresses.
"""
from __future__ import annotations

from typing import Optional

from app.config import get_settings
from app.middleware.rate_limit_store import RateLimitStore, build_store

_MAX_REQUESTS_PER_HOUR = 3
_WINDOW_SECONDS = 3600

_store_singleton: Optional[RateLimitStore] = None


def _get_store() -> RateLimitStore:
    global _store_singleton
    if _store_singleton is None:
        s = get_settings()
        _store_singleton = build_store(
            rest_url=s.upstash_redis_rest_url,
            rest_token=s.upstash_redis_rest_token,
        )
    return _store_singleton


def set_store_for_tests(store: RateLimitStore) -> None:
    """Swap the backing store in tests."""
    global _store_singleton
    _store_singleton = store


async def is_email_rate_limited(email: str) -> bool:
    """Return True when this email has exceeded the hourly request cap."""
    normalized = (email or "").strip().lower()
    if not normalized:
        return False
    key = f"magic_link:email:{normalized}"
    count = await _get_store().counter_incr(key, _WINDOW_SECONDS)
    return count > _MAX_REQUESTS_PER_HOUR
