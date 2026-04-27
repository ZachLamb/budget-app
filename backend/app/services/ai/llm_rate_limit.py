from __future__ import annotations

"""Per-user rolling-day rate limit for cloud (Tier 4) LLM calls.

Uses the existing RateLimitStore (Upstash in prod, in-memory in dev). Keyed
on user id to prevent a single user from blowing out the GPU budget.
"""

import logging
from typing import Optional

from app.middleware.rate_limit_store import RateLimitStore

logger = logging.getLogger(__name__)

_DAY_SECONDS = 86_400
DEFAULT_DAILY_LIMIT = 50


class RateLimitExceeded(Exception):
    def __init__(self, count: int, limit: int) -> None:
        self.count = count
        self.limit = limit
        super().__init__(f"Rate limit exceeded: {count}/{limit}")


async def check_and_charge(
    store: RateLimitStore,
    user_id: str,
    *,
    daily_limit: int = DEFAULT_DAILY_LIMIT,
) -> int:
    """Increment the user's daily counter; raise RateLimitExceeded when over.

    Returns the post-increment count. Failures of the underlying store
    fail open (return 0) — see UpstashStore docstring.
    """
    if daily_limit <= 0:
        return 0
    key = f"llm:user:{user_id}:day"
    result = await store.check_and_increment(key, daily_limit, _DAY_SECONDS)
    if result.over:
        raise RateLimitExceeded(count=result.count, limit=daily_limit)
    return result.count


async def remaining(store: RateLimitStore, user_id: str, *, daily_limit: int = DEFAULT_DAILY_LIMIT) -> int:
    key = f"llm:user:{user_id}:day"
    used = await store.counter_get(key)
    return max(daily_limit - used, 0)
