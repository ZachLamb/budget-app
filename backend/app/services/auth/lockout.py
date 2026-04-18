"""Per-email login-failure lockout.

The IP-based rate limit in ``app.middleware.rate_limit`` protects against
high-volume credential stuffing, but an attacker rotating IPs (botnet,
residential proxies) can still slowly grind through a single account.
This module layers an email-keyed failure counter on top: after
``_MAX_FAILURES`` failed logins in ``_WINDOW_SECONDS``, the account is
locked out for the remainder of the window regardless of source IP.

Good logins reset the counter immediately so legitimate users are not
locked by typos followed by a successful sign-in.

Storage is the shared :class:`RateLimitStore` so this works across
workers when Upstash is configured. When the in-memory store is used,
lockout is per-process (which is still better than nothing).
"""
from __future__ import annotations

from typing import Optional

from app.config import get_settings
from app.middleware.rate_limit_store import RateLimitStore, build_store

# Tune these if the threshold proves too tight or too loose in practice.
_MAX_FAILURES = 5
_WINDOW_SECONDS = 10 * 60  # 10 minutes


_store_singleton: Optional[RateLimitStore] = None


def _get_store() -> RateLimitStore:
    """Lazily build (and cache) the store from settings.

    Tests should call :func:`set_store_for_tests` to swap in a fresh
    in-memory instance so state doesn't bleed between cases.
    """
    global _store_singleton
    if _store_singleton is None:
        s = get_settings()
        _store_singleton = build_store(
            rest_url=s.upstash_redis_rest_url,
            rest_token=s.upstash_redis_rest_token,
        )
    return _store_singleton


def set_store_for_tests(store: Optional[RateLimitStore]) -> None:
    """Swap (or clear) the module-level store. Tests only."""
    global _store_singleton
    _store_singleton = store


def _key(email: str) -> str:
    return f"lockout:login:{email.strip().lower()}"


async def is_login_locked(email: str) -> bool:
    """True when this email has already tripped the failure threshold."""
    count = await _get_store().counter_get(_key(email))
    return count >= _MAX_FAILURES


async def record_login_failure(email: str) -> None:
    """Record one failed attempt against this email."""
    await _get_store().counter_incr(_key(email), _WINDOW_SECONDS)


async def clear_login_failures(email: str) -> None:
    """Reset the failure count on successful login."""
    await _get_store().counter_delete(_key(email))
