from __future__ import annotations

"""Global cost circuit breaker for cloud LLM calls.

Sums the last hour of audit rows and trips when total tokens or row count
crosses a configured threshold. When tripped, requests return a friendly
"temporarily unavailable" response instead of touching the GPU.

Trip thresholds default to:
  * 1_000_000 prompt+completion tokens / hour
  * 5_000 audit rows / hour

Both are global (across all users), tuned for a small household-scale app
with a paid GPU budget. Adjust via env vars when you have real numbers.
"""

import logging
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.llm import LlmAudit

logger = logging.getLogger(__name__)

DEFAULT_TOKENS_PER_HOUR = 1_000_000
DEFAULT_REQUESTS_PER_HOUR = 5_000

_cache: dict[str, tuple[bool, float]] = {}
_TTL_SECONDS = 30  # re-check at most every 30s


class CircuitOpen(Exception):
    """Raised when the breaker is tripped."""


async def is_open(
    db: AsyncSession,
    *,
    tokens_per_hour: int = DEFAULT_TOKENS_PER_HOUR,
    requests_per_hour: int = DEFAULT_REQUESTS_PER_HOUR,
) -> bool:
    """Return True when the breaker is tripped right now (cached for 30s)."""
    cached = _cache.get("global")
    now = time.monotonic()
    if cached is not None and cached[1] > now:
        return cached[0]

    since = datetime.now(timezone.utc) - timedelta(hours=1)
    # The breaker exists to cap GPU cost. Cache hits don't touch the GPU, so
    # exclude them from both row count and token totals — including them would
    # cause a hot prompt to trip the breaker even though it's free.
    res = await db.execute(
        select(
            func.count(LlmAudit.id),
            func.coalesce(func.sum(LlmAudit.prompt_tokens), 0),
            func.coalesce(func.sum(LlmAudit.completion_tokens), 0),
        )
        .where(LlmAudit.created_at >= since)
        .where(LlmAudit.cache_hit.is_(False))
    )
    count, p, c = res.one()
    total_tokens = int((p or 0) + (c or 0))
    tripped = bool(count >= requests_per_hour or total_tokens >= tokens_per_hour)
    _cache["global"] = (tripped, now + _TTL_SECONDS)
    if tripped:
        logger.warning(
            "llm_circuit_open count=%s tokens=%s thresholds=%s/%s",
            count,
            total_tokens,
            requests_per_hour,
            tokens_per_hour,
        )
    return tripped


def _reset_cache_for_tests() -> None:
    _cache.clear()
