"""Per-household sliding-window limit for authenticated AI routes (in-process)."""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict

from fastapi import HTTPException

_lock = asyncio.Lock()
_buckets: dict[str, list[float]] = defaultdict(list)


async def enforce_household_ai_rate_limit(household_id: str, max_per_minute: int) -> None:
    """Raise 429 when this household exceeds max_perMinute LLM-backed requests in a 60s window."""
    if max_per_minute <= 0:
        return
    window_sec = 60.0
    now = time.monotonic()
    cutoff = now - window_sec
    async with _lock:
        q = _buckets[household_id]
        while q and q[0] < cutoff:
            q.pop(0)
        if len(q) >= max_per_minute:
            raise HTTPException(
                429,
                "Too many AI requests for this household. Please wait a moment and try again.",
            )
        q.append(now)
